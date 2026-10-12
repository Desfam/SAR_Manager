// Rule-based assessment of Wazuh events. No AI: every verdict comes from fixed rules
// (rule level, Windows event ID, rule groups, MITRE, frequency, source IP) and says so.
import type { WazuhEvent } from '../wazuh-indexer.js';

export type Verdict = 'informational' | 'likely_benign' | 'review' | 'suspicious' | 'critical';
export type Risk = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface Assessment {
  verdict: Verdict;
  risk: Risk;
  confidence: 'low' | 'medium' | 'high';
  source: 'regelbasiert';
  category: string;
  why: string;
  evidence: string[];
  nextSteps: string[];
}

/** What a Windows event ID means and what to check */
export const WINDOWS_EVENTS: Record<string, { name: string; category: string; why: string; steps: string[]; weight: number }> = {
  '4624': { name: 'Erfolgreiche Anmeldung', category: 'Anmeldung', why: 'Anmeldungen zeigen, wer sich wann und woher anmeldet. Ungewöhnliche Konten, Zeiten oder Quellen sind ein Hinweis auf gestohlene Zugangsdaten.', steps: ['Konto und Anmeldetyp prüfen (2 = lokal, 3 = Netzwerk, 10 = RDP)', 'Quelle/IP prüfen', 'Gab es vorher fehlgeschlagene Anmeldungen (4625)?'], weight: 0 },
  '4625': { name: 'Fehlgeschlagene Anmeldung', category: 'Anmeldung', why: 'Gehäufte Fehlanmeldungen deuten auf Passwort-Raten (Brute Force) oder ein veraltetes, gespeichertes Passwort hin.', steps: ['Häufung je Konto und Quelle prüfen', 'Folgte eine erfolgreiche Anmeldung (4624)?', 'Quelle der Versuche ermitteln, ggf. Konto sperren'], weight: 1 },
  '4634': { name: 'Abmeldung', category: 'Anmeldung', why: 'Abmeldungen sind normaler Betrieb und vor allem zur zeitlichen Einordnung nützlich.', steps: ['Nur im Zusammenhang mit anderen Events relevant'], weight: -1 },
  '4647': { name: 'Abmeldung durch Benutzer', category: 'Anmeldung', why: 'Normaler Betrieb.', steps: ['Nur im Zusammenhang relevant'], weight: -1 },
  '4648': { name: 'Anmeldung mit expliziten Zugangsdaten', category: 'Anmeldung', why: 'Ein Prozess hat sich mit anderen Zugangsdaten angemeldet (z. B. runas). Kommt bei Admin-Tätigkeit vor, aber auch bei Lateral Movement.', steps: ['Welcher Prozess, welches Zielkonto?', 'Erwartete Admin-Tätigkeit?'], weight: 1 },
  '4672': { name: 'Spezielle Rechte bei Anmeldung', category: 'Rechte', why: 'Ein Konto mit Administrator-ähnlichen Rechten hat sich angemeldet.', steps: ['Ist das Konto als privilegiert bekannt?', 'Passt die Anmeldung zu geplanter Administration?'], weight: 0 },
  '4688': { name: 'Prozess gestartet', category: 'Prozess', why: 'Prozessstarts zeigen, was auf dem System ausgeführt wird. Auffällig sind Skript-Interpreter mit kodierten Befehlen, Tools zur Rechteausweitung oder Starts aus Temp-Verzeichnissen.', steps: ['Prozesspfad und Befehlszeile prüfen', 'Elternprozess prüfen', 'Ist das Programm auf dem Host üblich?'], weight: 0 },
  '4697': { name: 'Dienst installiert', category: 'Persistenz', why: 'Neue Dienste sind ein typischer Weg, sich dauerhaft auf einem System einzunisten.', steps: ['Dienstname und Pfad prüfen', 'Geplante Software-Installation?'], weight: 2 },
  '7045': { name: 'Dienst installiert', category: 'Persistenz', why: 'Neue Dienste sind ein typischer Weg, sich dauerhaft auf einem System einzunisten.', steps: ['Dienstname und Pfad prüfen', 'Geplante Software-Installation?'], weight: 2 },
  '4698': { name: 'Geplante Aufgabe erstellt', category: 'Persistenz', why: 'Geplante Aufgaben werden für Wartung, aber auch für Persistenz genutzt.', steps: ['Aufgabe und ausgeführten Befehl prüfen', 'Wer hat sie angelegt?'], weight: 2 },
  '4720': { name: 'Benutzerkonto erstellt', category: 'Konten', why: 'Neue Konten können ein Hinweis auf einen Angreifer sein, der sich Zugang sichert.', steps: ['War die Kontoanlage geplant?', 'Wer hat das Konto angelegt?'], weight: 2 },
  '4722': { name: 'Benutzerkonto aktiviert', category: 'Konten', why: 'Reaktivierte Konten können missbraucht werden.', steps: ['Geplante Änderung?'], weight: 1 },
  '4726': { name: 'Benutzerkonto gelöscht', category: 'Konten', why: 'Kontolöschungen können Spuren verwischen.', steps: ['Geplante Änderung?', 'Wer hat gelöscht?'], weight: 1 },
  '4728': { name: 'Mitglied zu globaler Gruppe hinzugefügt', category: 'Rechte', why: 'Gruppenänderungen können Rechte ausweiten.', steps: ['Welche Gruppe? Privilegiert?'], weight: 2 },
  '4732': { name: 'Mitglied zu lokaler Gruppe hinzugefügt', category: 'Rechte', why: 'Aufnahme in lokale Gruppen (z. B. Administratoren) weitet Rechte aus.', steps: ['Welche Gruppe? Administratoren?', 'Geplante Änderung?'], weight: 2 },
  '4756': { name: 'Mitglied zu universeller Gruppe hinzugefügt', category: 'Rechte', why: 'Gruppenänderungen können Rechte ausweiten.', steps: ['Welche Gruppe? Privilegiert?'], weight: 2 },
  '4768': { name: 'Kerberos-Ticket (TGT) angefordert', category: 'Anmeldung', why: 'Normaler Domänenbetrieb; auffällig bei ungewöhnlichen Konten oder Fehlercodes.', steps: ['Fehlercode und Konto prüfen'], weight: -1 },
  '4769': { name: 'Kerberos-Dienstticket angefordert', category: 'Anmeldung', why: 'Normaler Domänenbetrieb; Häufungen für viele Dienste können auf Kerberoasting hindeuten.', steps: ['Häufung je Konto prüfen', 'Verschlüsselungstyp (RC4) prüfen'], weight: -1 },
  '4771': { name: 'Kerberos-Vorauthentifizierung fehlgeschlagen', category: 'Anmeldung', why: 'Entspricht einer falschen Passworteingabe im Domänenkontext; Häufungen deuten auf Passwort-Raten.', steps: ['Häufung je Konto prüfen', 'Quelle der Anfragen ermitteln'], weight: 1 },
  '4776': { name: 'NTLM-Anmeldeprüfung', category: 'Anmeldung', why: 'NTLM ist anfälliger als Kerberos; Fehlversuche deuten auf Passwort-Raten.', steps: ['Fehlercode prüfen', 'Quelle ermitteln'], weight: 0 },
  '1102': { name: 'Sicherheitsprotokoll gelöscht', category: 'Spuren verwischen', why: 'Das Löschen des Sicherheitsprotokolls ist ein klassisches Zeichen, dass Spuren verwischt werden sollen.', steps: ['Wer hat gelöscht?', 'Was geschah unmittelbar davor?'], weight: 4 },
  '7031': { name: 'Dienst unerwartet beendet', category: 'Dienst', why: 'Ein abgestürzter Dienst ist meist ein Betriebsproblem; bei Sicherheitssoftware kann es Manipulation sein.', steps: ['Welcher Dienst?', 'Tritt es wiederholt auf?'], weight: 0 },
  '7036': { name: 'Dienststatus geändert', category: 'Dienst', why: 'Normaler Betrieb.', steps: ['Nur bei Sicherheitsdiensten relevant'], weight: -1 },
};

const SUSPICIOUS_PROCESS = /(mimikatz|procdump|psexec|wmic\s+.*process\s+call|-enc(odedcommand)?\s|frombase64string|invoke-expression|iex\s*\(|downloadstring|certutil.*-urlcache|bitsadmin.*\/transfer|rundll32.*javascript|regsvr32.*\/i:http|vssadmin.*delete|wevtutil\s+cl|net\s+user\s+.*\/add|nc(at)?\.exe|whoami\s+\/priv)/i;
const PRIVILEGED_USER = /^(administrator|admin|root|domain admins?|krbtgt)$/i;

const isPublicIp = (ip?: string) =>
  !!ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(ip);

const RISKS: Risk[] = ['info', 'low', 'medium', 'high', 'critical'];
const riskFromLevel = (level: number): Risk => (level >= 15 ? 'critical' : level >= 12 ? 'high' : level >= 7 ? 'medium' : level >= 4 ? 'low' : 'info');
const bump = (risk: Risk, steps: number): Risk => RISKS[Math.max(0, Math.min(RISKS.length - 1, RISKS.indexOf(risk) + steps))];

export interface AssessContext {
  /** Same rule on the same host in the time window */
  ruleCountOnHost?: number;
  /** Same rule across all hosts */
  ruleCountTotal?: number;
}

export function assessEvent(event: WazuhEvent, context: AssessContext = {}): Assessment {
  const evidence: string[] = [];
  const nextSteps: string[] = [];
  const groups = new Set(event.rule.groups.map((group) => group.trim()));
  const level = event.rule.level;
  let risk = riskFromLevel(level);
  let category = 'Allgemein';
  let why = 'Wazuh hat dieses Ereignis nach seiner Regel protokolliert.';
  let score = 0; // positive = more suspicious
  let known = false;

  evidence.push(`Regel-Level ${level} (${risk === 'info' ? 'Info' : risk === 'low' ? 'niedrig' : risk === 'medium' ? 'mittel' : risk === 'high' ? 'hoch' : 'kritisch'})`);

  const windows = event.eventId ? WINDOWS_EVENTS[event.eventId] : undefined;
  if (windows) {
    known = true;
    category = windows.category;
    why = windows.why;
    score += windows.weight;
    nextSteps.push(...windows.steps);
    evidence.push(`Windows-Event ${event.eventId}: ${windows.name}`);
  }

  const failedAuth = groups.has('authentication_failed') || groups.has('authentication_failures') || groups.has('invalid_login') || event.eventId === '4625' || event.eventId === '4771' || /fail(ed)? password|authentication failure|invalid user/i.test(event.rule.description ?? '');
  if (!windows) {
    if (failedAuth) {
      known = true;
      category = 'Anmeldung';
      why = 'Fehlgeschlagene Anmeldungen zeigen Passwort-Raten oder falsch konfigurierte Zugänge.';
      nextSteps.push('Häufung je Benutzer und Quelle prüfen', 'Folgte eine erfolgreiche Anmeldung?', 'Quelle blockieren, falls fremd');
      score += 1;
    } else if (groups.has('authentication_success') || groups.has('pam') || groups.has('sshd')) {
      known = true;
      category = 'Anmeldung';
      why = 'Erfolgreiche Anmeldungen und Sitzungen. Relevant, wenn Konto, Zeit oder Quelle ungewöhnlich sind.';
      nextSteps.push('Ist die Quelle bekannt (Admin-PC, Automatisierung)?', 'Passt die Uhrzeit?');
    } else if (groups.has('sudo') || groups.has('su')) {
      known = true;
      category = 'Rechte';
      why = 'Rechteausweitung auf root. Normal für Administration, wichtig zur Nachverfolgung.';
      nextSteps.push('Ausgeführten Befehl prüfen', 'Ist der Benutzer Administrator?');
    } else if (groups.has('syscheck') || groups.has('ossec') && /integrity|checksum/i.test(event.rule.description ?? '')) {
      known = true;
      category = 'Dateiintegrität';
      why = 'Eine überwachte Datei wurde geändert, angelegt oder gelöscht. Wichtig bei Konfigurationen, Programmen und Zugangsdateien.';
      nextSteps.push('Welche Datei, welche Änderung?', 'Geplante Änderung (Update, Admin)?');
      score += 1;
    } else if (groups.has('vulnerability-detector')) {
      known = true;
      category = 'Schwachstelle';
      why = `Auf dem Host ist eine Software mit bekannter Schwachstelle installiert${event.vulnerability?.cve ? ` (${event.vulnerability.cve})` : ''}.`;
      nextSteps.push('Betroffenes Paket aktualisieren', 'Ist der Dienst von außen erreichbar?');
    } else if (groups.has('rootcheck')) {
      known = true;
      category = 'Rootcheck';
      why = 'Wazuh-Rootcheck meldet verdächtige Dateien, Prozesse oder Einstellungen.';
      nextSteps.push('Meldung auf dem Host nachprüfen');
      score += 1;
    } else if (groups.has('sca')) {
      known = true;
      category = 'Konfigurationsprüfung';
      why = 'Ergebnis einer Konfigurationsprüfung (z. B. CIS-Benchmark).';
      nextSteps.push('Fehlgeschlagene Prüfungen im Wazuh-Dashboard ansehen');
    } else if (groups.has('systemd') || /service/i.test(event.rule.description ?? '')) {
      known = true;
      category = 'Dienst';
      why = 'Dienst-Ereignisse sind meist Betrieb; wiederholte Abstürze deuten auf Fehler, bei Sicherheitsdiensten auf Manipulation.';
      nextSteps.push('Welcher Dienst?', 'Wiederholt es sich?');
    } else if (groups.has('attack') || groups.has('exploit_attempt') || groups.has('web')) {
      known = true;
      category = 'Angriffsversuch';
      why = 'Die Regel erkennt Muster bekannter Angriffe.';
      nextSteps.push('Ziel und Quelle prüfen', 'War der Versuch erfolgreich (Antwortcodes, Folge-Events)?');
      score += 2;
    }
  }

  // Process content
  const processText = `${event.program ?? ''} ${event.fullLog ?? ''}`;
  if (SUSPICIOUS_PROCESS.test(processText)) {
    score += 3;
    evidence.push('Prozess/Befehl passt zu bekannten Angriffswerkzeugen oder Verschleierung');
    nextSteps.unshift('Befehlszeile und Elternprozess sofort prüfen');
  }

  // Accounts
  if (event.user && PRIVILEGED_USER.test(event.user.replace(/^.*\\/, ''))) {
    evidence.push(`Privilegiertes Konto: ${event.user}`);
    if (failedAuth) score += 1;
  }
  if (event.user && /\$$/.test(event.user)) evidence.push('Computerkonto (endet auf $): meist Systembetrieb');

  // Source
  if (isPublicIp(event.sourceIp)) {
    evidence.push(`Quelle ist eine öffentliche IP (${event.sourceIp})`);
    score += failedAuth || category === 'Anmeldung' ? 2 : 1;
    nextSteps.push(`Öffentliche Quelle ${event.sourceIp} prüfen (Reputation, Firewall)`);
  } else if (event.sourceIp) {
    evidence.push(`Quelle im internen Netz (${event.sourceIp})`);
  }

  // MITRE
  if (event.rule.mitre.ids.length) {
    evidence.push(`MITRE ATT&CK: ${event.rule.mitre.ids.join(', ')}${event.rule.mitre.tactics.length ? ` (${event.rule.mitre.tactics.join(', ')})` : ''}`);
    if (level >= 7) score += 1;
  }

  // Frequency
  const onHost = context.ruleCountOnHost ?? 0;
  if (onHost >= 50 && level < 7 && score <= 0) {
    evidence.push(`Kommt auf diesem Host häufig vor (${onHost}× im Zeitraum): Kandidat für die Baseline`);
    score -= 1;
  } else if (failedAuth && onHost >= 10) {
    evidence.push(`Häufung: ${onHost} gleiche Fehlanmeldungen auf diesem Host`);
    score += 2;
  } else if (onHost > 0 && onHost <= 2 && level >= 7) {
    evidence.push('Selten auf diesem Host');
    score += 1;
  }

  // Risk and verdict
  if (score >= 3) risk = bump(risk, 2);
  else if (score >= 1) risk = bump(risk, 1);
  else if (score <= -1 && risk !== 'info') risk = bump(risk, -1);

  const verdict: Verdict =
    risk === 'critical' ? 'critical' : risk === 'high' || score >= 3 ? 'suspicious' : risk === 'medium' || score >= 1 ? 'review' : risk === 'low' ? 'likely_benign' : 'informational';

  if (!nextSteps.length) nextSteps.push(verdict === 'informational' || verdict === 'likely_benign' ? 'Wahrscheinlich Routine. Nach Prüfung als Baseline vormerken.' : 'Event im Zusammenhang mit anderen Events des Hosts prüfen');
  if (verdict === 'likely_benign' && score <= 0 && !evidence.some((entry) => entry.includes('Baseline'))) evidence.push('Keine auffälligen Abweichungen');

  const confidence: Assessment['confidence'] = known && (Math.abs(score) >= 2 || level >= 12 || level <= 3) ? 'high' : known ? 'medium' : 'low';
  return { verdict, risk, confidence, source: 'regelbasiert', category, why, evidence, nextSteps: [...new Set(nextSteps)].slice(0, 6) };
}
