import {
  Activity,
  Bug,
  ClipboardList,
  Crosshair,
  FileSearch,
  GitCommitVertical,
  HeartPulse,
  Map as MapIcon,
  Monitor,
  PlugZap,
  ScanSearch,
  ShieldCheck,
  Siren,
  Target,
  Terminal as TerminalIcon,
  Waypoints,
  BarChart3,
  Bot,
  BrickWall,
  Code2,
  Container,
  FolderOpen,
  Layers,
  LayoutDashboard,
  ListChecks,
  Network,
  Radar,
  ScrollText,
  Server,
  Settings,
  Shield,
  SquareTerminal,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Short description for the page header and the command palette. */
  description: string;
  /** Planned for a later round: shown in the navigation, opens a placeholder */
  soon?: boolean;
}

export type Workspace = 'sar' | 'wazuh';

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAVIGATION: NavSection[] = [
  {
    label: 'Übersicht',
    items: [{ label: 'Dashboard', path: '/', icon: LayoutDashboard, description: 'Zustand der gesamten Infrastruktur auf einen Blick' }],
  },
  {
    label: 'Infrastruktur',
    items: [
      { label: 'Systeme', path: '/systems', icon: Server, description: 'SSH- und RDP-Verbindungen verwalten' },
      { label: 'Monitoring', path: '/monitoring', icon: Activity, description: 'CPU, RAM und Speicher aller VMs und Container' },
      { label: 'Proxmox', path: '/proxmox', icon: Layers, description: 'Nodes, VMs und Container auf Proxmox' },
      { label: 'Container', path: '/containers', icon: Container, description: 'Docker-Container auf allen Hosts' },
      { label: 'Netzwerk', path: '/network', icon: Network, description: 'Netzwerk-Map: Verbindungen ins lokale Netz und ins Internet' },
    ],
  },
  {
    label: 'Betrieb',
    items: [
      { label: 'Terminal', path: '/terminal', icon: SquareTerminal, description: 'SSH-Sitzungen direkt in der App' },
      { label: 'Dateien', path: '/files', icon: FolderOpen, description: 'Dateien auf entfernten Systemen' },
      { label: 'Scripts', path: '/scripts', icon: Code2, description: 'Scripts verwalten und ausführen' },
      { label: 'Jobs', path: '/jobs', icon: ListChecks, description: 'Laufende und vergangene Ausführungen' },
    ],
  },
  {
    label: 'Sicherheit',
    items: [
      { label: 'Alerts', path: '/alerts', icon: TriangleAlert, description: 'Aktive Warnungen und Schwellenwerte' },
      { label: 'Firewall', path: '/firewall', icon: BrickWall, description: 'Proxmox-Firewall je VM und Container' },
      { label: 'Security', path: '/security', icon: Shield, description: 'Absicherung je System: Isolation, Firewall, Updates, Zugänge, Dienste, Backup' },
      { label: 'Audit-Log', path: '/audit', icon: ScrollText, description: 'Wer hat wann was getan' },
    ],
  },
  {
    label: 'Verwaltung',
    items: [
      { label: 'Agents', path: '/agents', icon: Bot, description: 'Installierte Agents und ihre Verbindung' },
      { label: 'Benutzer', path: '/users', icon: Users, description: 'Benutzer, Rollen und Rechte' },
      { label: 'Einstellungen', path: '/settings', icon: Settings, description: 'App, Darstellung und Backend' },
    ],
  },
];

/** The Wazuh SOC workspace: switched to with the Wazuh button next to the logo */
export const WAZUH_NAVIGATION: NavSection[] = [
  {
    label: 'Home',
    items: [{ label: 'Dashboard', path: '/wazuh', icon: Radar, description: 'Live-Lage: Event-Stream, Bewertung, Kontext und Fleet' }],
  },
  {
    label: 'Explore',
    items: [
      { label: 'Investigation', path: '/wazuh/investigation', icon: FileSearch, description: 'Gezielte Event-Suche: host:, user:, eid:, rule:, ip:, level:' },
      { label: 'Timeline', path: '/wazuh/timeline', icon: GitCommitVertical, description: 'Zeitliche Ereigniskette eines Hosts oder Benutzers' },
      { label: 'Linux', path: '/wazuh/linux', icon: TerminalIcon, description: 'SSH, sudo, Dienste, Dateiintegrität auf Linux-Agents' },
      { label: 'Statistik', path: '/wazuh/analytics', icon: BarChart3, description: 'Events über die Zeit, Agents, Regeln, Gruppen und Quellen' },
      { label: 'Event Map', path: '/wazuh/event-map', icon: Waypoints, description: 'Zusammenhänge zwischen Hosts, Regeln und MITRE-Techniken' },
      { label: 'Exposure Map', path: '/wazuh/exposure', icon: MapIcon, description: 'Verbindungen interner Hosts nach außen' },
      { label: 'Full Scan', path: '/wazuh/full-scan', icon: ScanSearch, description: 'Ausführliche Auswertung eines Hosts' },
      { label: 'Baseline', path: '/wazuh/baseline', icon: Activity, description: 'Normales Verhalten je Host und Abweichungen' },
    ],
  },
  {
    label: 'Endpoint Security',
    items: [
      { label: 'Hosts', path: '/wazuh/hosts', icon: Monitor, description: 'Alle Wazuh-Agents mit Status, Events, Schwachstellen und Risiko' },
      { label: 'Integration', path: '/wazuh/integration', icon: PlugZap, description: 'Verbindung zu Indexer und Manager, Trust Center' },
    ],
  },
  {
    label: 'Security Operations',
    items: [
      { label: 'Incidents', path: '/wazuh/incidents', icon: Siren, description: 'Bearbeitbare Sicherheitsfälle' },
      { label: 'Findings', path: '/wazuh/findings', icon: ClipboardList, description: 'Zentrale Befundliste' },
    ],
  },
  {
    label: 'Threat Intelligence',
    items: [
      { label: 'MITRE ATT&CK', path: '/wazuh/mitre', icon: Target, description: 'Events nach Angriffstaktik und -technik' },
      { label: 'Schwachstellen', path: '/wazuh/vulnerabilities', icon: Bug, description: 'CVEs je Host und Paket aus Wazuh' },
      { label: 'IOC-Lookup', path: '/wazuh/ioc', icon: Crosshair, description: 'IP, Domain, Hash oder Benutzer in allen Events suchen' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Trust Center', path: '/wazuh/trust', icon: ShieldCheck, description: 'Funktioniert die Anbindung? Indexer, Cluster, Manager, Zertifikate' },
      { label: 'System Health', path: '/wazuh/health', icon: HeartPulse, description: 'Zustand von Manager, Indexer und Containern' },
    ],
  },
];

export const workspaceOf = (pathname: string): Workspace => (pathname === '/wazuh' || pathname.startsWith('/wazuh/') ? 'wazuh' : 'sar');
export const navigationFor = (workspace: Workspace) => (workspace === 'wazuh' ? WAZUH_NAVIGATION : NAVIGATION);

export const ALL_PAGES: NavItem[] = [...NAVIGATION, ...WAZUH_NAVIGATION].flatMap((section) => section.items);

/** The page for a path: the longest matching path wins (/wazuh/hosts before /wazuh) */
export function findPage(pathname: string): NavItem | undefined {
  return ALL_PAGES.filter((item) => (item.path === '/' ? pathname === '/' : pathname === item.path || pathname.startsWith(`${item.path}/`))).sort((a, b) => b.path.length - a.path.length)[0];
}

export function sectionOf(page: NavItem | undefined) {
  return [...NAVIGATION, ...WAZUH_NAVIGATION].find((group) => group.items.some((item) => item.path === page?.path))?.label;
}
