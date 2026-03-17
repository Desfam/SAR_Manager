import { SSHService } from './ssh.js';

export interface SecurityCheck {
  id: string;
  requirement: string;
  description: string;
  category: 'governance' | 'asset-management' | 'security-operations' | 'supply-chain' | 'incident-response';
  severity: 'critical' | 'high' | 'medium' | 'low';
  passed: boolean;
  remediation?: string;
  remediationCommand?: string;
  details?: string;
}

export interface SecurityAudit {
  hostId: string;
  hostName: string;
  timestamp: string;
  score: number;
  passed: SecurityCheck[];
  failed: SecurityCheck[];
  status: 'completed' | 'failed';
}

export class SecurityService {
  /**
   * Run NIS2 compliance audit on a connection
   */
  static async runNIS2Audit(connection: any): Promise<SecurityAudit> {
    const checks: SecurityCheck[] = [];
    const connConfig = {
      host: connection.host,
      port: connection.port,
      username: connection.username,
      password: connection.password,
      privateKey: connection.private_key_path,
      authType: connection.auth_type,
    };

    // Check 1: SSH Key Authentication
    const sshKeyCheck = await this.checkSSHKeyAuth(connConfig, connection);
    checks.push(sshKeyCheck);

    // Check 2: Password Policy
    const passwordCheck = await this.checkPasswordPolicy(connConfig);
    checks.push(passwordCheck);

    // Check 3: Firewall Status
    const firewallCheck = await this.checkFirewall(connConfig);
    checks.push(firewallCheck);

    // Check 4: System Updates
    const updatesCheck = await this.checkSystemUpdates(connConfig);
    checks.push(updatesCheck);

    // Check 5: Audit Logging
    const auditLogCheck = await this.checkAuditLogging(connConfig);
    checks.push(auditLogCheck);

    // Check 6: SSH Configuration
    const sshConfigCheck = await this.checkSSHConfig(connConfig);
    checks.push(sshConfigCheck);

    // Check 7: Running Services
    const servicesCheck = await this.checkRunningServices(connConfig);
    checks.push(servicesCheck);

    // Check 8: Fail2Ban Status
    const fail2BanCheck = await this.checkFail2Ban(connConfig);
    checks.push(fail2BanCheck);

    // Check 9: AppArmor/SELinux
    const securityModuleCheck = await this.checkSecurityModules(connConfig);
    checks.push(securityModuleCheck);

    // Check 10: Automatic Security Updates
    const autoUpdatesCheck = await this.checkAutomaticUpdates(connConfig);
    checks.push(autoUpdatesCheck);

    // Calculate score
    const passedChecks = checks.filter(c => c.passed);
    const score = Math.round((passedChecks.length / checks.length) * 100);

    return {
      hostId: connection.id,
      hostName: connection.name,
      timestamp: new Date().toISOString(),
      score,
      passed: passedChecks,
      failed: checks.filter(c => !c.passed),
      status: 'completed',
    };
  }

  private static async checkSSHKeyAuth(connConfig: any, connection: any): Promise<SecurityCheck> {
    const check: SecurityCheck = {
      id: 'nis2-01',
      requirement: 'SSH Key Authentication',
      description: 'SSH keys must be used instead of passwords (Ed25519 or RSA recommended)',
      category: 'security-operations',
      severity: 'critical',
      passed: false,
      remediation: 'Generate Ed25519 SSH keys for all connections. Disable password-based SSH authentication. Use SSH agent with passphrases. Store private keys securely.',
      remediationCommand: 'ssh-keygen -t ed25519 -C "your_email@example.com" && ssh-copy-id -i ~/.ssh/id_ed25519.pub user@host',
    };

    try {
      // Check if connection uses key-based auth
      if (connection.auth_type === 'key') {
        check.passed = true;
        check.details = 'Using key-based authentication';
      } else {
        check.details = 'Using password authentication (not recommended)';
      }
    } catch (error) {
      check.details = 'Unable to determine authentication method';
    }

    return check;
  }

  private static async checkPasswordPolicy(connConfig: any): Promise<SecurityCheck> {
    const check: SecurityCheck = {
      id: 'nis2-02',
      requirement: 'Password Policy',
      description: 'Strong password policies must be enforced',
      category: 'governance',
      severity: 'high',
      passed: false,
      remediation: 'Install libpam-pwquality. Configure /etc/security/pwquality.conf with minlen=12, minclass=3. Set password history in /etc/pam.d/common-password.',
      remediationCommand: 'sudo apt install -y libpam-pwquality && echo -e "minlen = 12\nminclass = 3" | sudo tee -a /etc/security/pwquality.conf',
    };

    try {
      const result = await SSHService.executeCommand(
        connConfig,
        'test -f /etc/security/pwquality.conf && grep -E "minlen|minclass" /etc/security/pwquality.conf 2>/dev/null || echo NOTFOUND'
      );

      if (result.data?.stdout && !result.data.stdout.includes('NOTFOUND') && result.data.stdout.includes('minlen')) {
        check.passed = true;
        check.details = 'Password quality checking is configured';
      } else {
        check.details = 'Password quality checking not configured or not found';
      }
    } catch (error) {
      check.details = 'Unable to check password policy configuration';
    }

    return check;
  }

  private static async checkFirewall(connConfig: any): Promise<SecurityCheck> {
    const check: SecurityCheck = {
      id: 'nis2-03',
      requirement: 'Firewall Active',
      description: 'System firewall must be enabled and configured',
      category: 'security-operations',
      severity: 'critical',
      passed: false,
      remediation: 'Enable UFW: sudo ufw enable. Configure allowed services: sudo ufw allow 22/tcp. Review rules: sudo ufw status.',
      remediationCommand: 'sudo apt install -y ufw && sudo ufw allow 22/tcp && sudo ufw --force enable',
    };

    try {
      // Check for ufw, firewalld, iptables, or nftables
      const result = await SSHService.executeCommand(
        connConfig,
        'systemctl is-active firewalld 2>/dev/null || command -v ufw >/dev/null && ufw status 2>/dev/null || iptables -L -n 2>/dev/null | head -5 || nft list ruleset 2>/dev/null | head -5 || echo NOFIREWALL'
      );

      if (result.data?.stdout) {
        const stdout = result.data.stdout;
        if (stdout.includes('active') || stdout.includes('Status: active') || 
            stdout.includes('Chain INPUT') || stdout.includes('table inet')) {
          check.passed = true;
          // Determine which firewall
          if (stdout.includes('firewalld') || result.data.stdout.split('\n')[0].trim() === 'active') {
            check.details = 'firewalld is active';
          } else if (stdout.includes('Status: active')) {
            check.details = 'ufw is active';
          } else if (stdout.includes('table inet')) {
            check.details = 'nftables is configured';
          } else {
            check.details = 'iptables is configured';
          }
        } else if (stdout.includes('NOFIREWALL')) {
          check.details = 'No firewall detected';
        } else {
          check.details = 'Firewall is inactive';
        }
      }
    } catch (error) {
      check.details = 'Unable to check firewall status';
    }

    return check;
  }

  private static async checkSystemUpdates(connConfig: any): Promise<SecurityCheck> {
    const check: SecurityCheck = {
      id: 'nis2-04',
      requirement: 'System Updates',
      description: 'System must have recent security updates installed',
      category: 'security-operations',
      severity: 'high',
      passed: false,
      remediation: 'Update package lists: sudo apt update. Install updates: sudo apt upgrade -y. Enable automatic security updates: sudo apt install unattended-upgrades.',
      remediationCommand: 'sudo apt update && sudo apt upgrade -y',
    };

    try {
      const result = await SSHService.executeCommand(
        connConfig,
        'apt list --upgradable 2>/dev/null | wc -l || yum check-update 2>/dev/null | wc -l || echo 0'
      );

      const updates = parseInt(result.data?.stdout?.trim() || '999');
      if (updates <= 5) {
        check.passed = true;
        check.details = `${updates} pending updates`;
      } else {
        check.details = `${updates} pending updates (exceeds threshold)`;
      }
    } catch (error) {
      check.details = 'Unable to check for updates';
    }

    return check;
  }

  private static async checkAuditLogging(connConfig: any): Promise<SecurityCheck> {
    const check: SecurityCheck = {
      id: 'nis2-05',
      requirement: 'Audit Logging',
      description: 'System audit logging must be enabled',
      category: 'security-operations',
      severity: 'high',
      passed: false,
      remediation: 'Install auditd: sudo apt install auditd. Enable service: sudo systemctl enable auditd. Configure rules in /etc/audit/rules.d/.',
      remediationCommand: 'sudo apt install -y auditd && sudo systemctl enable --now auditd',
    };

    try {
      const result = await SSHService.executeCommand(
        connConfig,
        'systemctl is-active auditd 2>/dev/null || service auditd status 2>/dev/null | grep -i running || echo NOTINSTALLED'
      );

      if (result.data?.stdout && result.data.stdout.includes('active')) {
        check.passed = true;
        check.details = 'Auditd service is active';
      } else {
        check.details = 'Auditd is not running or not installed';
      }
    } catch (error) {
      check.details = 'Unable to check audit daemon status';
    }

    return check;
  }

  private static async checkSSHConfig(connConfig: any): Promise<SecurityCheck> {
    const check: SecurityCheck = {
      id: 'nis2-06',
      requirement: 'SSH Hardening',
      description: 'SSH must be configured securely (disable root login, use protocol 2)',
      category: 'security-operations',
      severity: 'critical',
      passed: false,
      remediation: 'Edit /etc/ssh/sshd_config: Set PermitRootLogin no, Protocol 2, PasswordAuthentication no. Restart SSH: sudo systemctl restart sshd.',
      remediationCommand: 'sudo sed -i "s/^#\?PermitRootLogin.*/PermitRootLogin no/" /etc/ssh/sshd_config && sudo sed -i "s/^#\?PasswordAuthentication.*/PasswordAuthentication no/" /etc/ssh/sshd_config && sudo systemctl restart sshd',
    };

    try {
      const result = await SSHService.executeCommand(
        connConfig,
        'grep -E "^PermitRootLogin|^PasswordAuthentication|^Protocol" /etc/ssh/sshd_config 2>/dev/null || echo NOTFOUND'
      );

      if (result.data?.stdout) {
        const rootLoginDisabled = result.data.stdout.includes('PermitRootLogin no') || 
                                  result.data.stdout.includes('PermitRootLogin without-password');
        const passwordAuthDisabled = result.data.stdout.includes('PasswordAuthentication no');
        
        if (rootLoginDisabled || passwordAuthDisabled) {
          check.passed = true;
          check.details = 'SSH security settings configured';
        } else {
          check.details = 'SSH hardening not fully implemented';
        }
      }
    } catch (error) {
      check.details = 'Unable to check SSH configuration';
    }

    return check;
  }

  private static async checkRunningServices(connConfig: any): Promise<SecurityCheck> {
    const check: SecurityCheck = {
      id: 'nis2-07',
      requirement: 'Minimal Services',
      description: 'Only necessary services should be running',
      category: 'asset-management',
      severity: 'medium',
      passed: false,
      remediation: 'Review running services: systemctl list-units --type=service --state=running. Disable unnecessary services: sudo systemctl disable <service>.',
      remediationCommand: 'systemctl list-units --type=service --state=running',
    };

    try {
      const result = await SSHService.executeCommand(
        connConfig,
        'systemctl list-units --type=service --state=running 2>/dev/null | grep -c ".service" || ps aux | wc -l'
      );

      const serviceCount = parseInt(result.data?.stdout?.trim() || '999');
      if (serviceCount < 50) {
        check.passed = true;
        check.details = `${serviceCount} running services`;
      } else {
        check.details = `${serviceCount} running services (review recommended)`;
      }
    } catch (error) {
      check.details = 'Unable to enumerate running services';
    }

    return check;
  }

  private static async checkFail2Ban(connConfig: any): Promise<SecurityCheck> {
    const check: SecurityCheck = {
      id: 'nis2-08',
      requirement: 'Intrusion Prevention',
      description: 'Fail2Ban or similar intrusion prevention must be active',
      category: 'security-operations',
      severity: 'high',
      passed: false,
      remediation: 'Install fail2ban: sudo apt install fail2ban. Enable service: sudo systemctl enable fail2ban. Configure jails in /etc/fail2ban/jail.local.',
      remediationCommand: 'sudo apt install -y fail2ban && sudo systemctl enable --now fail2ban',
    };

    try {
      const result = await SSHService.executeCommand(
        connConfig,
        'systemctl is-active fail2ban 2>/dev/null || echo NOTINSTALLED'
      );

      if (result.data?.stdout && result.data.stdout.includes('active')) {
        check.passed = true;
        check.details = 'Fail2Ban is active';
      } else {
        check.details = 'Fail2Ban is not running or not installed';
      }
    } catch (error) {
      check.details = 'Unable to check Fail2Ban status';
    }

    return check;
  }

  private static async checkSecurityModules(connConfig: any): Promise<SecurityCheck> {
    const check: SecurityCheck = {
      id: 'nis2-09',
      requirement: 'Mandatory Access Control',
      description: 'AppArmor or SELinux must be enabled',
      category: 'security-operations',
      severity: 'medium',
      passed: false,
      remediation: 'Enable AppArmor: sudo systemctl enable apparmor. Check status: sudo aa-status. For SELinux: getenforce (should show Enforcing).',
      remediationCommand: 'sudo apt install -y apparmor apparmor-utils && sudo systemctl enable --now apparmor',
    };

    try {
      // Check AppArmor (systemctl or aa-status) or SELinux
      const result = await SSHService.executeCommand(
        connConfig,
        'systemctl is-active apparmor 2>/dev/null || aa-status 2>/dev/null | head -1 || getenforce 2>/dev/null || echo NOTFOUND'
      );

      if (result.data?.stdout) {
        const stdout = result.data.stdout;
        if (stdout.includes('active') || stdout.includes('profiles are loaded') || 
            stdout.includes('Enforcing') || stdout.includes('apparmor module is loaded')) {
          check.passed = true;
          if (stdout.includes('apparmor') || stdout.includes('active') || stdout.includes('profiles')) {
            check.details = 'AppArmor is enabled';
          } else {
            check.details = 'SELinux is enforcing';
          }
        } else {
          check.details = 'No mandatory access control detected';
        }
      }
    } catch (error) {
      check.details = 'Unable to check security modules';
    }

    return check;
  }

  private static async checkAutomaticUpdates(connConfig: any): Promise<SecurityCheck> {
    const check: SecurityCheck = {
      id: 'nis2-10',
      requirement: 'Automatic Security Updates',
      description: 'Automatic security updates must be configured',
      category: 'security-operations',
      severity: 'high',
      passed: false,
      remediation: 'Install unattended-upgrades: sudo apt install unattended-upgrades. Enable: sudo dpkg-reconfigure -plow unattended-upgrades.',
      remediationCommand: 'sudo apt install -y unattended-upgrades && echo unattended-upgrades unattended-upgrades/enable_auto_updates boolean true | sudo debconf-set-selections && sudo dpkg-reconfigure -f noninteractive unattended-upgrades',
    };

    try {
      const result = await SSHService.executeCommand(
        connConfig,
        'dpkg -l unattended-upgrades 2>/dev/null | grep "^ii" || test -f /etc/apt/apt.conf.d/20auto-upgrades && echo CONFIGURED || echo NOTINSTALLED'
      );

      if (result.data?.stdout && (result.data.stdout.includes('ii') || result.data.stdout.includes('CONFIGURED'))) {
        check.passed = true;
        check.details = 'Automatic updates are configured';
      } else {
        check.details = 'Automatic updates not configured';
      }
    } catch (error) {
      check.details = 'Unable to check automatic updates configuration';
    }

    return check;
  }
}
