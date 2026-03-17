package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"time"

	"os/exec"
)

// ─────────────────────────────────────────────
//  Data types
// ─────────────────────────────────────────────

type AuditSummary struct {
	Passed   int `json:"passed"`
	Failed   int `json:"failed"`
	Warnings int `json:"warnings"`
}

type AuditFinding struct {
	ID       string `json:"id"`
	Severity string `json:"severity"` // critical, high, medium, low, info
	Status   string `json:"status"`   // passed, failed, warning
	Message  string `json:"message"`
	Detail   string `json:"detail,omitempty"`
}

type AuditResult struct {
	JobID     string       `json:"job_id"`
	AgentID   string       `json:"agent_id"`
	AuditType string       `json:"audit_type"`
	Status    string       `json:"status"` // success, error
	Score     int          `json:"score"`
	Summary   AuditSummary `json:"summary"`
	Findings  []AuditFinding `json:"findings"`
	Timestamp string       `json:"timestamp"`
}

// AuditEngine runs local security audits and returns structured findings.
type AuditEngine struct {
	logger *Logger
}

func NewAuditEngine(logger *Logger) *AuditEngine {
	return &AuditEngine{logger: logger}
}

// Run dispatches the requested audit type and returns the result.
func (ae *AuditEngine) Run(jobID, agentID, auditType string, options map[string]interface{}) AuditResult {
	ae.logger.Info("Running audit: %s (job: %s)", auditType, jobID)

	switch auditType {
	case "linux_baseline_audit":
		return ae.runLinuxBaseline(jobID, agentID)
	case "ssh_hardening_audit":
		return ae.runSSHHardening(jobID, agentID)
	case "patch_status_audit":
		return ae.runPatchStatus(jobID, agentID)
	case "filesystem_permissions_audit":
		return ae.runFilesystemPermissions(jobID, agentID)
	default:
		return AuditResult{
			JobID: jobID, AgentID: agentID, AuditType: auditType,
			Status:    "error",
			Timestamp: time.Now().Format(time.RFC3339),
			Findings: []AuditFinding{{
				ID: "unknown_audit_type", Severity: "info", Status: "failed",
				Message: fmt.Sprintf("Unsupported audit type: %s", auditType),
			}},
		}
	}
}

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

// readSSHDConfig parses /etc/ssh/sshd_config and returns lowercase key→value pairs.
func readSSHDConfig() map[string]string {
	cfg := make(map[string]string)
	for _, path := range []string{"/etc/ssh/sshd_config", "/etc/sshd_config"} {
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		defer f.Close()
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				cfg[strings.ToLower(parts[0])] = parts[1]
			}
		}
		break
	}
	return cfg
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return !os.IsNotExist(err)
}

func runCmd(name string, args ...string) (string, error) {
	out, err := exec.Command(name, args...).Output()
	return strings.TrimSpace(string(out)), err
}

func computeScore(findings []AuditFinding) int {
	score := 100
	for _, f := range findings {
		if f.Status == "failed" {
			switch f.Severity {
			case "critical":
				score -= 20
			case "high":
				score -= 12
			case "medium":
				score -= 6
			case "low":
				score -= 3
			}
		} else if f.Status == "warning" {
			switch f.Severity {
			case "critical":
				score -= 10
			case "high":
				score -= 6
			case "medium":
				score -= 3
			case "low":
				score -= 1
			}
		}
	}
	if score < 0 {
		score = 0
	}
	return score
}

func computeSummary(findings []AuditFinding) AuditSummary {
	var s AuditSummary
	for _, f := range findings {
		switch f.Status {
		case "passed":
			s.Passed++
		case "failed":
			s.Failed++
		case "warning":
			s.Warnings++
		}
	}
	return s
}

func pass(id, sev, msg string) AuditFinding {
	return AuditFinding{ID: id, Severity: sev, Status: "passed", Message: msg}
}

func fail(id, sev, msg, detail string) AuditFinding {
	return AuditFinding{ID: id, Severity: sev, Status: "failed", Message: msg, Detail: detail}
}

func warn(id, sev, msg, detail string) AuditFinding {
	return AuditFinding{ID: id, Severity: sev, Status: "warning", Message: msg, Detail: detail}
}

func wrapResult(jobID, agentID, auditType string, findings []AuditFinding) AuditResult {
	return AuditResult{
		JobID: jobID, AgentID: agentID, AuditType: auditType,
		Status:    "success",
		Score:     computeScore(findings),
		Summary:   computeSummary(findings),
		Findings:  findings,
		Timestamp: time.Now().Format(time.RFC3339),
	}
}

// ─────────────────────────────────────────────
//  linux_baseline_audit
// ─────────────────────────────────────────────

func (ae *AuditEngine) runLinuxBaseline(jobID, agentID string) AuditResult {
	var f []AuditFinding
	cfg := readSSHDConfig()

	// 1. SSH root login
	rootLogin := strings.ToLower(cfg["permitrootlogin"])
	switch rootLogin {
	case "no", "prohibit-password":
		f = append(f, pass("ssh_root_login", "high", "SSH root login is disabled"))
	case "yes", "":
		f = append(f, fail("ssh_root_login", "high", "SSH root login is enabled",
			"Set PermitRootLogin prohibit-password or no in sshd_config"))
	default:
		f = append(f, warn("ssh_root_login", "high",
			fmt.Sprintf("SSH root login setting: %s", rootLogin), ""))
	}

	// 2. SSH password auth
	if strings.ToLower(cfg["passwordauthentication"]) == "no" {
		f = append(f, pass("ssh_password_auth", "medium", "SSH password authentication is disabled"))
	} else {
		f = append(f, warn("ssh_password_auth", "medium", "SSH password authentication is enabled",
			"Consider key-based auth only: set PasswordAuthentication no"))
	}

	// 3. SSH empty passwords
	if emp := strings.ToLower(cfg["permitemptypasswords"]); emp == "no" || emp == "" {
		f = append(f, pass("ssh_empty_passwords", "critical", "SSH empty passwords are disabled"))
	} else {
		f = append(f, fail("ssh_empty_passwords", "critical", "SSH empty passwords are allowed",
			"Set PermitEmptyPasswords no in sshd_config"))
	}

	// 4. Firewall
	if fileExists("/usr/sbin/ufw") {
		out, err := runCmd("ufw", "status")
		if err == nil && strings.Contains(strings.ToLower(out), "status: active") {
			f = append(f, pass("firewall_active", "high", "UFW firewall is active"))
		} else {
			f = append(f, fail("firewall_active", "high", "UFW firewall is not active", "Run: ufw enable"))
		}
	} else if fileExists("/usr/sbin/iptables") {
		out, err := runCmd("iptables", "-L", "-n")
		if err == nil && strings.Count(out, "\n") > 8 {
			f = append(f, pass("firewall_active", "high", "iptables rules are configured"))
		} else {
			f = append(f, warn("firewall_active", "high", "iptables may not have active rules",
				"Review iptables rules"))
		}
	} else {
		f = append(f, fail("firewall_active", "high", "No firewall tool detected (ufw/iptables)",
			"Install and enable a firewall"))
	}

	// 5. Automatic security updates
	hasAutoUpdates := fileExists("/etc/apt/apt.conf.d/50unattended-upgrades") ||
		fileExists("/etc/apt/apt.conf.d/20auto-upgrades")
	if hasAutoUpdates {
		f = append(f, pass("auto_security_updates", "medium", "Automatic security updates configured"))
	} else {
		f = append(f, fail("auto_security_updates", "medium", "Automatic security updates not configured",
			"Install: apt install unattended-upgrades"))
	}

	// 6. Fail2ban
	hasFail2ban := fileExists("/etc/fail2ban/jail.conf") || fileExists("/etc/fail2ban/jail.local")
	if hasFail2ban {
		out, _ := runCmd("systemctl", "is-active", "fail2ban")
		if strings.TrimSpace(out) == "active" {
			f = append(f, pass("fail2ban_active", "medium", "fail2ban is installed and active"))
		} else {
			f = append(f, warn("fail2ban_active", "medium", "fail2ban is installed but not active",
				"Run: systemctl enable --now fail2ban"))
		}
	} else {
		f = append(f, warn("fail2ban_active", "medium", "fail2ban is not installed",
			"Consider: apt install fail2ban"))
	}

	// 7. Accounts with empty passwords (requires shadow group or root)
	out, err := runCmd("awk", "-F:", `($2 == "") {print $1}`, "/etc/shadow")
	if err == nil {
		if strings.TrimSpace(out) == "" {
			f = append(f, pass("no_empty_password_accounts", "critical", "No accounts with empty passwords"))
		} else {
			f = append(f, fail("no_empty_password_accounts", "critical",
				fmt.Sprintf("Accounts with empty passwords: %s", out),
				"Lock or set passwords for all accounts"))
		}
	}

	// 8. sudo NOPASSWD ALL
	nopassAll := false
	sudoFiles := []string{"/etc/sudoers"}
	if entries, err := os.ReadDir("/etc/sudoers.d"); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				sudoFiles = append(sudoFiles, "/etc/sudoers.d/"+e.Name())
			}
		}
	}
	for _, sf := range sudoFiles {
		data, err := os.ReadFile(sf)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, "#") &&
				strings.Contains(line, "NOPASSWD:") &&
				strings.Contains(line, "ALL") {
				nopassAll = true
				break
			}
		}
	}
	if !nopassAll {
		f = append(f, pass("sudo_no_nopasswd_all", "high", "No unrestricted NOPASSWD ALL sudo entries found"))
	} else {
		f = append(f, warn("sudo_no_nopasswd_all", "high", "NOPASSWD ALL found in sudo configuration",
			"Restrict NOPASSWD to specific commands only"))
	}

	return wrapResult(jobID, agentID, "linux_baseline_audit", f)
}

// ─────────────────────────────────────────────
//  ssh_hardening_audit
// ─────────────────────────────────────────────

func (ae *AuditEngine) runSSHHardening(jobID, agentID string) AuditResult {
	var f []AuditFinding
	cfg := readSSHDConfig()

	// Port
	if port := cfg["port"]; port == "" || port == "22" {
		f = append(f, warn("ssh_port_nondefault", "low", "SSH running on default port 22",
			"Consider using a non-standard port to reduce automated scanning"))
	} else {
		f = append(f, pass("ssh_port_nondefault", "low",
			fmt.Sprintf("SSH on non-default port %s", port)))
	}

	// X11Forwarding
	if x11 := strings.ToLower(cfg["x11forwarding"]); x11 == "no" || x11 == "" {
		f = append(f, pass("ssh_x11_forwarding", "medium", "X11 forwarding is disabled"))
	} else {
		f = append(f, fail("ssh_x11_forwarding", "medium", "X11 forwarding is enabled",
			"Set X11Forwarding no in sshd_config unless required"))
	}

	// MaxAuthTries
	if mat := cfg["maxauthtries"]; mat == "" {
		f = append(f, warn("ssh_max_auth_tries", "medium", "MaxAuthTries not configured (default: 6)",
			"Set MaxAuthTries 3 in sshd_config"))
	} else {
		f = append(f, pass("ssh_max_auth_tries", "medium",
			fmt.Sprintf("MaxAuthTries is set to %s", mat)))
	}

	// ClientAliveInterval
	if cai := cfg["clientaliveinterval"]; cai == "" || cai == "0" {
		f = append(f, warn("ssh_client_alive", "low", "ClientAliveInterval not configured — idle sessions may persist",
			"Set ClientAliveInterval 300 and ClientAliveCountMax 3"))
	} else {
		f = append(f, pass("ssh_client_alive", "low",
			fmt.Sprintf("ClientAliveInterval set to %s", cai)))
	}

	// Banner
	if banner := cfg["banner"]; banner == "" || banner == "none" {
		f = append(f, warn("ssh_banner", "low", "SSH login banner not configured",
			"Set Banner /etc/issue.net in sshd_config"))
	} else {
		f = append(f, pass("ssh_banner", "low", "SSH login banner is configured"))
	}

	// LogLevel
	ll := strings.ToUpper(cfg["loglevel"])
	if ll == "" || ll == "QUIET" || ll == "FATAL" || ll == "ERROR" {
		f = append(f, warn("ssh_log_level", "medium",
			fmt.Sprintf("SSH log level is low: %s", ll),
			"Set LogLevel VERBOSE in sshd_config for better audit trails"))
	} else {
		f = append(f, pass("ssh_log_level", "medium",
			fmt.Sprintf("SSH log level is %s", ll)))
	}

	// Protocol v1
	if cfg["protocol"] == "1" {
		f = append(f, fail("ssh_protocol_v2", "critical", "SSH Protocol version 1 is configured",
			"Remove Protocol directive (v2 is default in modern OpenSSH)"))
	} else {
		f = append(f, pass("ssh_protocol_v2", "critical", "SSH Protocol v1 is not enabled"))
	}

	// AllowUsers / AllowGroups
	if cfg["allowusers"] != "" || cfg["allowgroups"] != "" {
		f = append(f, pass("ssh_access_restriction", "medium",
			"SSH access restricted via AllowUsers/AllowGroups"))
	} else {
		f = append(f, warn("ssh_access_restriction", "medium",
			"No AllowUsers or AllowGroups configured",
			"Restrict SSH access to specific users/groups"))
	}

	return wrapResult(jobID, agentID, "ssh_hardening_audit", f)
}

// ─────────────────────────────────────────────
//  patch_status_audit
// ─────────────────────────────────────────────

func (ae *AuditEngine) runPatchStatus(jobID, agentID string) AuditResult {
	var f []AuditFinding

	if fileExists("/usr/bin/apt") || fileExists("/usr/bin/apt-get") {
		// Count available upgrades from cached lists (no network)
		out, err := runCmd("apt-get", "--simulate", "--no-download", "upgrade")
		if err == nil || true { // apt-get --simulate may return non-0 if updates exist
			updateCount := 0
			for _, line := range strings.Split(out, "\n") {
				if strings.HasPrefix(line, "Inst ") {
					updateCount++
				}
			}
			if updateCount == 0 {
				f = append(f, pass("packages_up_to_date", "high", "All packages are up to date"))
			} else {
				sev := "medium"
				if updateCount > 30 {
					sev = "high"
				}
				f = append(f, fail("packages_up_to_date", sev,
					fmt.Sprintf("%d package update(s) available", updateCount),
					"Run: apt-get upgrade"))
			}

			// Count security updates
			secCount := 0
			for _, line := range strings.Split(out, "\n") {
				if strings.HasPrefix(line, "Inst ") && strings.Contains(strings.ToLower(line), "security") {
					secCount++
				}
			}
			if secCount == 0 {
				f = append(f, pass("security_updates_pending", "critical", "No security updates pending"))
			} else {
				f = append(f, fail("security_updates_pending", "critical",
					fmt.Sprintf("%d security update(s) pending", secCount),
					"Run: apt-get dist-upgrade or enable unattended-upgrades"))
			}
		}

		// unattended-upgrades
		if fileExists("/usr/bin/unattended-upgrade") {
			f = append(f, pass("unattended_upgrades", "medium", "unattended-upgrades is installed"))
		} else {
			f = append(f, fail("unattended_upgrades", "medium", "unattended-upgrades is not installed",
				"Run: apt install unattended-upgrades"))
		}

	} else if fileExists("/usr/bin/dnf") || fileExists("/usr/bin/yum") {
		cmd := "yum"
		if fileExists("/usr/bin/dnf") {
			cmd = "dnf"
		}
		out, err := runCmd(cmd, "check-update", "--quiet")
		// exit 100 = updates available; 0 = up to date
		if err != nil && strings.Contains(out, "\n") {
			lines := strings.Split(strings.TrimSpace(out), "\n")
			count := 0
			for _, l := range lines {
				if strings.TrimSpace(l) != "" && !strings.HasPrefix(l, "Last metadata") {
					count++
				}
			}
			f = append(f, fail("packages_up_to_date", "high",
				fmt.Sprintf("%d package update(s) available", count),
				fmt.Sprintf("Run: %s update", cmd)))
		} else {
			f = append(f, pass("packages_up_to_date", "high", "All packages are up to date"))
		}
	} else {
		f = append(f, warn("package_manager", "info",
			"No supported package manager found (apt/yum/dnf)", ""))
	}

	// Last apt update stamp
	if info, err := os.Stat("/var/lib/apt/periodic/update-success-stamp"); err == nil {
		age := time.Since(info.ModTime())
		hours := age.Hours()
		switch {
		case hours < 24:
			f = append(f, pass("apt_last_update", "medium",
				fmt.Sprintf("Package lists updated %.0fh ago", hours)))
		case hours < 7*24:
			f = append(f, warn("apt_last_update", "medium",
				fmt.Sprintf("Package lists last updated %.0fh ago", hours),
				"Run: apt-get update"))
		default:
			f = append(f, fail("apt_last_update", "high",
				fmt.Sprintf("Package lists not updated for %.0f days", hours/24),
				"Run: apt-get update"))
		}
	}

	return wrapResult(jobID, agentID, "patch_status_audit", f)
}

// ─────────────────────────────────────────────
//  filesystem_permissions_audit
// ─────────────────────────────────────────────

func (ae *AuditEngine) runFilesystemPermissions(jobID, agentID string) AuditResult {
	var f []AuditFinding

	type fileCheck struct {
		path    string
		maxPerm os.FileMode
		id      string
		sev     string
	}

	checks := []fileCheck{
		{"/etc/passwd", 0644, "passwd_perms", "medium"},
		{"/etc/shadow", 0640, "shadow_perms", "critical"},
		{"/etc/group", 0644, "group_perms", "medium"},
		{"/etc/sudoers", 0440, "sudoers_perms", "high"},
		{"/etc/ssh/sshd_config", 0644, "sshd_config_perms", "high"},
	}

	for _, c := range checks {
		info, err := os.Stat(c.path)
		if err != nil {
			f = append(f, warn(c.id, "info", fmt.Sprintf("%s not found", c.path), ""))
			continue
		}
		actual := info.Mode().Perm()
		if actual&(^c.maxPerm) == 0 {
			f = append(f, pass(c.id, c.sev,
				fmt.Sprintf("%s permissions are correct (%s)", c.path, actual)))
		} else {
			f = append(f, fail(c.id, c.sev,
				fmt.Sprintf("%s permissions too permissive: %s", c.path, actual),
				fmt.Sprintf("Expected max: %s", c.maxPerm)))
		}
	}

	// World-writable files in /etc
	out, err := runCmd("find", "/etc", "-maxdepth", "2", "-perm", "-o+w", "-not", "-type", "l")
	if err == nil {
		ww := strings.TrimSpace(out)
		if ww == "" {
			f = append(f, pass("etc_world_writable", "critical",
				"No world-writable files found in /etc"))
		} else {
			count := len(strings.Split(ww, "\n"))
			f = append(f, fail("etc_world_writable", "critical",
				fmt.Sprintf("%d world-writable file(s) found in /etc", count), ww))
		}
	}

	// /tmp sticky bit
	if info, err := os.Stat("/tmp"); err == nil {
		if info.Mode()&os.ModeSticky != 0 {
			f = append(f, pass("tmp_sticky_bit", "medium", "/tmp has sticky bit set"))
		} else {
			f = append(f, fail("tmp_sticky_bit", "medium",
				"/tmp does not have the sticky bit set", "Run: chmod +t /tmp"))
		}
	}

	return wrapResult(jobID, agentID, "filesystem_permissions_audit", f)
}
