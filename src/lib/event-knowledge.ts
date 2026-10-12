// Reference knowledge for the event detail panel: official Windows event titles, logon types, failure codes and lookup links.

/** Official Microsoft titles of common Windows security / system events */
export const WINDOWS_EVENT_TITLE: Record<string, string> = {
  '1100': 'The event logging service has shut down',
  '1102': 'The audit log was cleared',
  '4608': 'Windows is starting up',
  '4616': 'The system time was changed',
  '4624': 'An account was successfully logged on',
  '4625': 'An account failed to log on',
  '4634': 'An account was logged off',
  '4647': 'User initiated logoff',
  '4648': 'A logon was attempted using explicit credentials',
  '4656': 'A handle to an object was requested',
  '4663': 'An attempt was made to access an object',
  '4672': 'Special privileges assigned to new logon',
  '4688': 'A new process has been created',
  '4689': 'A process has exited',
  '4697': 'A service was installed in the system',
  '4698': 'A scheduled task was created',
  '4699': 'A scheduled task was deleted',
  '4700': 'A scheduled task was enabled',
  '4702': 'A scheduled task was updated',
  '4719': 'System audit policy was changed',
  '4720': 'A user account was created',
  '4722': 'A user account was enabled',
  '4723': "An attempt was made to change an account's password",
  '4724': "An attempt was made to reset an account's password",
  '4725': 'A user account was disabled',
  '4726': 'A user account was deleted',
  '4728': 'A member was added to a security-enabled global group',
  '4732': 'A member was added to a security-enabled local group',
  '4738': 'A user account was changed',
  '4740': 'A user account was locked out',
  '4756': 'A member was added to a security-enabled universal group',
  '4767': 'A user account was unlocked',
  '4768': 'A Kerberos authentication ticket (TGT) was requested',
  '4769': 'A Kerberos service ticket was requested',
  '4771': 'Kerberos pre-authentication failed',
  '4776': 'The computer attempted to validate the credentials for an account',
  '4778': 'A session was reconnected to a Window Station',
  '4779': 'A session was disconnected from a Window Station',
  '4798': "A user's local group membership was enumerated",
  '4799': 'A security-enabled local group membership was enumerated',
  '5140': 'A network share object was accessed',
  '5145': 'A network share object was checked to see whether client can be granted desired access',
  '5156': 'The Windows Filtering Platform has permitted a connection',
  '5157': 'The Windows Filtering Platform has blocked a connection',
  '6005': 'The Event log service was started',
  '6006': 'The Event log service was stopped',
  '6008': 'The previous system shutdown was unexpected',
  '7031': 'A service terminated unexpectedly',
  '7034': 'A service terminated unexpectedly',
  '7036': 'A service entered the running/stopped state',
  '7040': 'The start type of a service was changed',
  '7045': 'A service was installed in the system',
};

/** Windows logon types (events 4624, 4625, 4634) */
export const LOGON_TYPE: Record<string, { name: string; meaning: string }> = {
  '0': { name: 'System', meaning: 'Nur vom System-Konto beim Start verwendet' },
  '2': { name: 'Interaktiv', meaning: 'Anmeldung direkt an Tastatur und Bildschirm des Rechners' },
  '3': { name: 'Netzwerk', meaning: 'Zugriff über das Netzwerk, z. B. auf Freigaben (SMB) oder per NTLM/Kerberos' },
  '4': { name: 'Batch', meaning: 'Geplante Aufgabe läuft unter diesem Konto' },
  '5': { name: 'Dienst', meaning: 'Ein Windows-Dienst wurde unter diesem Konto gestartet' },
  '7': { name: 'Entsperren', meaning: 'Bildschirm wurde entsperrt' },
  '8': { name: 'NetworkCleartext', meaning: 'Netzwerkanmeldung mit Klartext-Passwort (z. B. IIS Basic Auth). Kritisch, wenn unverschlüsselt.' },
  '9': { name: 'NewCredentials', meaning: 'runas /netonly: andere Zugangsdaten nur für Netzwerkzugriffe' },
  '10': { name: 'RemoteInteractive', meaning: 'Remotedesktop (RDP) bzw. Terminaldienste' },
  '11': { name: 'CachedInteractive', meaning: 'Anmeldung mit zwischengespeicherten Domänen-Zugangsdaten, ohne Domänencontroller' },
  '12': { name: 'CachedRemoteInteractive', meaning: 'RDP mit zwischengespeicherten Zugangsdaten' },
  '13': { name: 'CachedUnlock', meaning: 'Entsperren mit zwischengespeicherten Zugangsdaten' },
};

/** NTSTATUS codes in failed logons (4625 Status/SubStatus, 4776) */
export const LOGON_FAILURE: Record<string, string> = {
  '0xc000006a': 'Falsches Passwort',
  '0xc0000064': 'Benutzername existiert nicht',
  '0xc000006d': 'Benutzername oder Passwort falsch',
  '0xc000006e': 'Kontoeinschränkung',
  '0xc000006f': 'Anmeldung außerhalb der erlaubten Zeiten',
  '0xc0000070': 'Anmeldung von diesem Rechner nicht erlaubt',
  '0xc0000071': 'Passwort abgelaufen',
  '0xc0000072': 'Konto deaktiviert',
  '0xc0000133': 'Uhrzeit zwischen Client und Domänencontroller weicht ab',
  '0xc000015b': 'Anmeldetyp für dieses Konto nicht erlaubt',
  '0xc0000193': 'Konto abgelaufen',
  '0xc0000224': 'Passwort muss bei nächster Anmeldung geändert werden',
  '0xc0000234': 'Konto gesperrt',
  '0xc0000413': 'Authentifizierungs-Firewall: Anmeldung nicht erlaubt',
};

/** Kerberos failure codes (4768, 4771) */
export const KERBEROS_FAILURE: Record<string, string> = {
  '0x6': 'Benutzername unbekannt',
  '0x12': 'Konto gesperrt, deaktiviert oder abgelaufen',
  '0x17': 'Passwort abgelaufen',
  '0x18': 'Falsches Passwort (Vorauthentifizierung fehlgeschlagen)',
  '0x25': 'Uhrzeit weicht zu stark ab',
};

export interface LookupLink {
  label: string;
  url: string;
}

/** Where to read up on an event online */
export function lookupLinks(event: { eventId?: string; platform?: string; rule: { id?: string; description?: string }; vulnerability?: { cve?: string }; decoder?: string }): LookupLink[] {
  const links: LookupLink[] = [];
  if (event.eventId && event.platform === 'windows') {
    links.push({ label: `Event ${event.eventId} · Ultimate Windows Security`, url: `https://www.ultimatewindowssecurity.com/securitylog/encyclopedia/event.aspx?eventid=${event.eventId}` });
    links.push({ label: `Event ${event.eventId} · Microsoft Learn`, url: `https://learn.microsoft.com/de-de/search/?terms=${encodeURIComponent(`event ${event.eventId}`)}` });
  }
  if (event.vulnerability?.cve) {
    links.push({ label: `${event.vulnerability.cve} · NVD`, url: `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(event.vulnerability.cve)}` });
  }
  if (event.rule.id) {
    links.push({ label: `Wazuh-Regel ${event.rule.id} · Ruleset`, url: `https://github.com/search?q=${encodeURIComponent(`repo:wazuh/wazuh id="${event.rule.id}"`)}&type=code` });
  }
  if (event.rule.description) {
    links.push({ label: 'Websuche zur Beschreibung', url: `https://duckduckgo.com/?q=${encodeURIComponent(`${event.rule.description} ${event.eventId ? `event ${event.eventId}` : 'wazuh'}`)}` });
  }
  return links;
}
