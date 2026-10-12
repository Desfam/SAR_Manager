package main

import "testing"

func TestClassify(t *testing.T) {
	cases := []struct {
		entry map[string]interface{}
		kind  string
		user  string
		ip    string
	}{
		{map[string]interface{}{"MESSAGE": "Failed password for invalid user admin from 203.0.113.9 port 4242 ssh2", "_COMM": "sshd", "PRIORITY": "6"}, "ssh_failed", "admin", "203.0.113.9"},
		{map[string]interface{}{"MESSAGE": "Accepted publickey for root from 172.21.5.111 port 50000 ssh2", "_COMM": "sshd-session", "PRIORITY": "6"}, "ssh_accepted", "root", "172.21.5.111"},
		{map[string]interface{}{"MESSAGE": "Invalid user test from 198.51.100.4 port 22", "_COMM": "sshd", "PRIORITY": "6"}, "ssh_invalid_user", "test", "198.51.100.4"},
		{map[string]interface{}{"MESSAGE": "tactical : TTY=pts/0 ; PWD=/home/tactical ; USER=root ; COMMAND=/usr/bin/apt update", "_COMM": "sudo", "PRIORITY": "5"}, "sudo", "tactical", ""},
		{map[string]interface{}{"MESSAGE": "Out of memory: Killed process 123 (java)", "_TRANSPORT": "kernel", "PRIORITY": "3"}, "kernel", "", ""},
	}
	for _, c := range cases {
		event, ok := classify(c.entry)
		if !ok || event.Kind != c.kind || event.User != c.user || event.IP != c.ip {
			t.Errorf("%q: got %+v ok=%v", c.entry["MESSAGE"], event, ok)
		}
	}
	// noise is dropped: PAM session lines and the sudo -n true probe
	for _, noise := range []map[string]interface{}{
		{"MESSAGE": "pam_unix(sshd:session): session opened for user root", "_COMM": "sshd", "PRIORITY": "6"},
		{"MESSAGE": "tactical : a password is required ; USER=root ; COMMAND=/usr/bin/true", "_COMM": "sudo", "PRIORITY": "5"},
	} {
		if event, ok := classify(noise); ok {
			t.Errorf("noise kept: %+v", event)
		}
	}
}

func TestCollectFactsSmoke(t *testing.T) {
	facts := CollectFacts("test")
	if facts.OS == "" || len(facts.Disks) == 0 {
		t.Errorf("facts incomplete: %+v", facts)
	}
	t.Logf("os=%s kernel=%s updates=%d security=%d reboot=%v failed=%v sshd=%v disks=%d listening=%d user=%s", facts.OS, facts.Kernel, facts.Updates, facts.SecurityUpdates, facts.RebootRequired, facts.FailedUnits, facts.SSHD, len(facts.Disks), len(facts.Listening), facts.User)
}

func TestEventCollectorSmoke(t *testing.T) {
	collector := NewEventCollector(t.TempDir(), NewLogger(struct {
		Level      string `yaml:"level"`
		File       string `yaml:"file"`
		MaxSize    int    `yaml:"max_size"`
		MaxBackups int    `yaml:"max_backups"`
	}{Level: "error"}))
	events, cursor, readable := collector.Collect()
	t.Logf("events=%d readable=%v cursor=%v", len(events), readable, cursor != "")
	for i, event := range events {
		if i >= 3 {
			break
		}
		t.Logf("%s %s %s", event.Kind, event.Source, event.Message)
	}
}
