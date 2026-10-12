package main

// Periodic state report for SAR Manager (what the full scan used to read over SSH). Read-only.

import (
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
)

type FactsPayload struct {
	AgentID         string            `json:"agent_id"`
	CollectedAt     string            `json:"collected_at"`
	OS              string            `json:"os"`
	Kernel          string            `json:"kernel"`
	UptimeSeconds   uint64            `json:"uptime_seconds"`
	Updates         int               `json:"updates"`
	SecurityUpdates int               `json:"security_updates"`
	UpdateNames     []string          `json:"update_names"`
	RebootRequired  bool              `json:"reboot_required"`
	FailedUnits     []string          `json:"failed_units"`
	SSHD            map[string]string `json:"sshd"`
	Listening       []string          `json:"listening"`
	Disks           []DiskFact        `json:"disks"`
	User            string            `json:"user"`
}

type DiskFact struct {
	Mount       string  `json:"mount"`
	UsedPercent float64 `json:"used_percent"`
	TotalBytes  uint64  `json:"total_bytes"`
}

func output(name string, args ...string) string {
	cmd := exec.Command(name, args...)
	out, _ := cmd.Output()
	return strings.TrimSpace(string(out))
}

func lines(text string) []string {
	result := []string{}
	for _, line := range strings.Split(text, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			result = append(result, line)
		}
	}
	return result
}

var pseudoFS = map[string]bool{"tmpfs": true, "devtmpfs": true, "overlay": true, "squashfs": true, "proc": true, "sysfs": true, "fuse.lxcfs": true, "nsfs": true, "cgroup2": true}

func CollectFacts(agentID string) FactsPayload {
	facts := FactsPayload{AgentID: agentID, CollectedAt: time.Now().UTC().Format(time.RFC3339), SSHD: map[string]string{}, FailedUnits: []string{}, Listening: []string{}, UpdateNames: []string{}}
	if info, err := host.Info(); err == nil {
		facts.OS = strings.TrimSpace(info.Platform + " " + info.PlatformVersion)
		facts.Kernel = info.KernelVersion
		facts.UptimeSeconds = info.Uptime
	}
	facts.User = output("id", "-un")

	if _, err := exec.LookPath("apt"); err == nil {
		for _, line := range lines(output("apt", "list", "--upgradable")) {
			if strings.HasPrefix(line, "Listing") || strings.HasPrefix(line, "WARNING") {
				continue
			}
			facts.Updates++
			if strings.Contains(line, "-security") {
				facts.SecurityUpdates++
			}
			if len(facts.UpdateNames) < 40 {
				facts.UpdateNames = append(facts.UpdateNames, strings.SplitN(line, "/", 2)[0])
			}
		}
	}
	_, err := os.Stat("/var/run/reboot-required")
	facts.RebootRequired = err == nil

	for _, line := range lines(output("systemctl", "--failed", "--no-legend", "--plain")) {
		facts.FailedUnits = append(facts.FailedUnits, strings.Fields(line)[0])
	}
	for key, value := range readSSHDConfig() {
		switch key {
		case "permitrootlogin", "passwordauthentication", "port", "pubkeyauthentication":
			facts.SSHD[key] = value
		}
	}
	// listening sockets without process names (those would need root)
	for _, line := range lines(output("ss", "-lntuH")) {
		fields := strings.Fields(line)
		if len(fields) >= 5 {
			facts.Listening = append(facts.Listening, fields[0]+" "+fields[4])
		}
		if len(facts.Listening) >= 80 {
			break
		}
	}
	if partitions, err := disk.Partitions(false); err == nil {
		seen := map[string]bool{}
		for _, partition := range partitions {
			if pseudoFS[partition.Fstype] || seen[partition.Mountpoint] {
				continue
			}
			seen[partition.Mountpoint] = true
			if usage, err := disk.Usage(partition.Mountpoint); err == nil && usage.Total > 0 {
				facts.Disks = append(facts.Disks, DiskFact{Mount: partition.Mountpoint, UsedPercent: float64(int(usage.UsedPercent*10)) / 10, TotalBytes: usage.Total})
			}
		}
	}
	return facts
}
