package main

// Journal events for SAR Manager: SSH logins, sudo, errors and kernel problems, read from the systemd journal
// with a persisted cursor, so nothing is sent twice or lost across reconnects. Read-only.

import (
	"bufio"
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type JournalEvent struct {
	Time     string `json:"time"`
	Kind     string `json:"kind"` // ssh_failed | ssh_invalid_user | ssh_accepted | sudo | error | kernel
	Source   string `json:"source"`
	User     string `json:"user,omitempty"`
	IP       string `json:"ip,omitempty"`
	Method   string `json:"method,omitempty"`
	Command  string `json:"command,omitempty"`
	Message  string `json:"message"`
	Priority int    `json:"priority"`
}

type EventsPayload struct {
	AgentID string         `json:"agent_id"`
	Events  []JournalEvent `json:"events"`
	// false: the agent user may not read the whole journal, the list is incomplete
	Readable bool `json:"readable"`
}

type EventCollector struct {
	cursorPath string
	cursor     string
	logger     *Logger
}

var (
	reSSHFailed   = regexp.MustCompile(`Failed (\S+) for (?:invalid user )?(\S+) from (\S+)`)
	reSSHInvalid  = regexp.MustCompile(`Invalid user (\S*) from (\S+)`)
	reSSHAccepted = regexp.MustCompile(`Accepted (\S+) for (\S+) from (\S+)`)
	reSudo        = regexp.MustCompile(`^\s*(\S+)\s*:.*COMMAND=(.*)$`)
	reSudoAs      = regexp.MustCompile(`USER=([^\s;]+)`)
)

const maxEventsPerBatch = 2000

func NewEventCollector(stateDir string, logger *Logger) *EventCollector {
	ec := &EventCollector{cursorPath: filepath.Join(stateDir, "journal.cursor"), logger: logger}
	if data, err := os.ReadFile(ec.cursorPath); err == nil {
		ec.cursor = strings.TrimSpace(string(data))
	}
	return ec
}

// Collect reads new journal entries. The returned cursor must be committed after the events were delivered.
func (ec *EventCollector) Collect() ([]JournalEvent, string, bool) {
	if _, err := exec.LookPath("journalctl"); err != nil {
		return nil, ec.cursor, false
	}
	args := []string{"-o", "json", "--no-pager", "-n", strconv.Itoa(maxEventsPerBatch)}
	if ec.cursor != "" {
		args = append(args, "--after-cursor="+ec.cursor)
	} else {
		args = append(args, "--since=-15min")
	}
	// (sshd OR sudo) + (priority emergency..error)
	args = append(args, "_COMM=sshd", "_COMM=sshd-session", "_COMM=sudo", "+", "PRIORITY=0", "PRIORITY=1", "PRIORITY=2", "PRIORITY=3")

	cmd := exec.Command("journalctl", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	readable := !strings.Contains(stderr.String(), "not seeing messages from other users")
	if err != nil && len(out) == 0 {
		ec.logger.Debug("journalctl failed: %v %s", err, stderr.String())
		return nil, ec.cursor, readable
	}

	events := make([]JournalEvent, 0, 64)
	cursor := ec.cursor
	scanner := bufio.NewScanner(bytes.NewReader(out))
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		var entry map[string]interface{}
		if json.Unmarshal(scanner.Bytes(), &entry) != nil {
			continue
		}
		if c, ok := entry["__CURSOR"].(string); ok {
			cursor = c
		}
		if event, ok := classify(entry); ok {
			events = append(events, event)
		}
	}
	return events, cursor, readable
}

func (ec *EventCollector) Commit(cursor string) {
	if cursor == "" || cursor == ec.cursor {
		return
	}
	ec.cursor = cursor
	_ = os.MkdirAll(filepath.Dir(ec.cursorPath), 0700)
	_ = os.WriteFile(ec.cursorPath, []byte(cursor), 0600)
}

func field(entry map[string]interface{}, name string) string {
	value, _ := entry[name].(string)
	return value
}

func classify(entry map[string]interface{}) (JournalEvent, bool) {
	message := field(entry, "MESSAGE")
	if message == "" {
		return JournalEvent{}, false
	}
	comm := field(entry, "_COMM")
	source := field(entry, "SYSLOG_IDENTIFIER")
	if source == "" {
		source = comm
	}
	priority, _ := strconv.Atoi(field(entry, "PRIORITY"))
	event := JournalEvent{Source: source, Priority: priority, Message: truncate(message, 400)}
	if micros, err := strconv.ParseInt(field(entry, "__REALTIME_TIMESTAMP"), 10, 64); err == nil {
		event.Time = time.UnixMicro(micros).UTC().Format(time.RFC3339)
	}

	switch {
	case comm == "sshd" || comm == "sshd-session":
		if m := reSSHAccepted.FindStringSubmatch(message); m != nil {
			event.Kind, event.Method, event.User, event.IP = "ssh_accepted", m[1], m[2], m[3]
		} else if m := reSSHFailed.FindStringSubmatch(message); m != nil {
			event.Kind, event.Method, event.User, event.IP = "ssh_failed", m[1], m[2], m[3]
		} else if m := reSSHInvalid.FindStringSubmatch(message); m != nil {
			event.Kind, event.User, event.IP = "ssh_invalid_user", m[1], m[2]
		} else if priority <= 3 {
			event.Kind = "error"
		} else {
			return JournalEvent{}, false
		}
	case comm == "sudo":
		m := reSudo.FindStringSubmatch(message)
		// skip PAM session lines and permission probes ("sudo -n true")
		if m == nil || strings.TrimSpace(m[2]) == "/usr/bin/true" {
			if priority <= 3 {
				event.Kind = "error"
				return event, true
			}
			return JournalEvent{}, false
		}
		event.Kind, event.User, event.Command = "sudo", m[1], truncate(strings.TrimSpace(m[2]), 300)
		if as := reSudoAs.FindStringSubmatch(message); as != nil {
			event.Message = truncate(message, 400)
			if as[1] != "root" {
				event.User = m[1] + " → " + as[1]
			}
		}
	case field(entry, "_TRANSPORT") == "kernel":
		event.Kind = "kernel"
	default:
		event.Kind = "error"
	}
	return event, true
}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max] + " …"
}
