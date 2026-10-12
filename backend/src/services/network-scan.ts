// LAN discovery and quick scan with nmap, running as the normal user (no root):
// 1. discover: TCP-connect ping sweep; every address on the local link also gets an ARP request,
//    so the kernel neighbour table afterwards lists MACs of all hosts that answered ARP.
// 2. quick: top-100 TCP ports with light version detection on the hosts found.
// Each host is then classified (printer, PC, server, VM …) with the reasons shown to the user.
import { spawn, execFile, type ChildProcess } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export type DeviceKind = 'router' | 'network' | 'hypervisor' | 'server' | 'pc' | 'printer' | 'nas' | 'camera' | 'phone' | 'mobile' | 'vm' | 'iot' | 'self' | 'unknown';

export interface ScanPort {
  port: number;
  proto: string;
  service?: string;
  product?: string;
  version?: string;
  ostype?: string;
  title?: string;
}

export interface ScanDevice {
  ip: string;
  hostname?: string;
  mac?: string;
  vendor?: string;
  randomMac?: boolean;
  ports?: ScanPort[];
  kind: DeviceKind;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  os?: string;
}

export interface ScanJob {
  id: string;
  subnet: string;
  mode: 'discover' | 'quick';
  phase: 'discover' | 'ports' | 'done' | 'failed' | 'cancelled';
  progress: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  devices: ScanDevice[];
}

/* ---------- vendor lookup (nmap's OUI list) ---------- */

let vendors: Map<string, string> | null = null;
function vendorOf(mac: string): string | undefined {
  if (!vendors) {
    vendors = new Map();
    const file = '/usr/share/nmap/nmap-mac-prefixes';
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line || line.startsWith('#')) continue;
        const space = line.indexOf(' ');
        if (space > 0) vendors.set(line.slice(0, space).toUpperCase(), line.slice(space + 1).trim());
      }
    }
  }
  const hex = mac.replace(/[^0-9a-f]/gi, '').toUpperCase();
  return vendors.get(hex.slice(0, 9)) ?? vendors.get(hex.slice(0, 7)) ?? vendors.get(hex.slice(0, 6));
}

/** Locally administered bit: randomized MACs of phones/laptops, or virtual NICs */
const isRandomMac = (mac: string) => (parseInt(mac.slice(0, 2), 16) & 0b10) !== 0;

/* ---------- subnets ---------- */

const PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

function toInt(ip: string) {
  return ip.split('.').reduce((sum, part) => sum * 256 + Number(part), 0);
}
function fromInt(value: number) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

export function localSubnets() {
  const result: Array<{ iface: string; address: string; cidr: string }> = [];
  for (const [iface, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal || !address.cidr) continue;
      const prefix = Number(address.cidr.split('/')[1]);
      const network = fromInt((toInt(address.address) & (prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0)) >>> 0);
      const cidr = `${network}/${prefix}`;
      if (!result.some((entry) => entry.cidr === cidr)) result.push({ iface, address: address.address, cidr });
    }
  }
  return result;
}

/** Only private IPv4 networks, at most a /22 (1024 addresses) */
export function validateSubnet(value: string): string | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(value.trim());
  if (!match) return 'Netz als CIDR angeben, z. B. 172.21.4.0/22';
  if (match.slice(1, 5).some((part) => Number(part) > 255)) return 'Ungültige IP-Adresse';
  const prefix = Number(match[5]);
  if (prefix < 22 || prefix > 32) return 'Netzgröße zwischen /22 und /32';
  if (!PRIVATE.some((pattern) => pattern.test(value))) return 'Nur private Netze (10.x, 172.16–31.x, 192.168.x)';
  return null;
}

/* ---------- nmap XML ---------- */

const attr = (tag: string, name: string) => {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? match[1].replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#xa;/g, ' ').replace(/&amp;/g, '&') : undefined;
};

function parseHosts(xml: string) {
  const hosts: Array<{ ip: string; up: boolean; hostname?: string; mac?: string; vendor?: string; ports: ScanPort[] }> = [];
  for (const block of xml.match(/<host[\s>][\s\S]*?<\/host>/g) ?? []) {
    const ip = attr(/<address [^>]*addrtype="ipv4"[^>]*>/.exec(block)?.[0] ?? '', 'addr');
    if (!ip) continue;
    const macTag = /<address [^>]*addrtype="mac"[^>]*>/.exec(block)?.[0];
    const status = attr(/<status [^>]*>/.exec(block)?.[0] ?? '', 'state');
    const hostname = attr(/<hostname [^>]*>/.exec(block)?.[0] ?? '', 'name');
    const ports: ScanPort[] = [];
    for (const portBlock of block.match(/<port [\s\S]*?<\/port>/g) ?? []) {
      if (attr(/<state [^>]*>/.exec(portBlock)?.[0] ?? '', 'state') !== 'open') continue;
      const serviceTag = /<service [^>]*>/.exec(portBlock)?.[0] ?? '';
      const titleTag = /<script id="http-title"[^>]*>/.exec(portBlock)?.[0];
      ports.push({
        port: Number(attr(portBlock, 'portid')),
        proto: attr(portBlock, 'protocol') ?? 'tcp',
        service: attr(serviceTag, 'name'),
        product: attr(serviceTag, 'product'),
        version: attr(serviceTag, 'version'),
        ostype: attr(serviceTag, 'ostype'),
        title: titleTag ? attr(titleTag, 'output')?.slice(0, 120) : undefined,
      });
    }
    hosts.push({ ip, up: status === 'up', hostname, mac: macTag ? attr(macTag, 'addr') : undefined, vendor: macTag ? attr(macTag, 'vendor') : undefined, ports });
  }
  return hosts;
}

/* ---------- classification ---------- */

const VENDOR_RULES: Array<{ pattern: RegExp; kind: DeviceKind; label: string }> = [
  { pattern: /Hewlett|HP Inc|Brother|Kyocera|Canon|Epson|Ricoh|Xerox|Lexmark|Konica|Sharp|Oki Data|Toshiba Tec/i, kind: 'printer', label: 'Druckerhersteller' },
  { pattern: /Cisco|Ubiquiti|MikroTik|Routerboard|TP-Link|Netgear|Aruba|Juniper|Fortinet|Sophos|Lancom|Zyxel|AVM|D-Link|Hirschmann|Extreme Networks|Ruckus|Meraki|Allied Telesis|HPE|Hewlett Packard Enterprise/i, kind: 'network', label: 'Netzwerkhersteller' },
  { pattern: /Synology|QNAP|Western Digital|Buffalo|Asustor|TerraMaster/i, kind: 'nas', label: 'NAS-Hersteller' },
  { pattern: /Hikvision|Dahua|Axis Communications|Mobotix|Hanwha|Reolink|Uniview/i, kind: 'camera', label: 'Kamerahersteller' },
  { pattern: /Yealink|Snom|Gigaset|Polycom|Grandstream|Auerswald|Mitel|Avaya|Unify|Poly\b/i, kind: 'phone', label: 'Telefonhersteller' },
  { pattern: /Proxmox/i, kind: 'vm', label: 'Proxmox-Netzwerkkarte' },
  { pattern: /VMware|QEMU|Xensource|Microsoft Hyper|Parallels|VirtualBox|innotek/i, kind: 'vm', label: 'virtuelle Netzwerkkarte' },
  { pattern: /Espressif|Tuya|Shelly|Sonos|Philips Lighting|Signify|Amazon Technologies|Google|Raspberry/i, kind: 'iot', label: 'IoT-Hersteller' },
  { pattern: /Apple|Samsung|Xiaomi|Huawei|OnePlus|Oppo|Motorola|Nokia|Fairphone/i, kind: 'mobile', label: 'Smartphone-Hersteller' },
  { pattern: /Dell|Lenovo|Fujitsu|Intel Corporate|ASUSTek|Micro-Star|Giga-?byte|ASRock|Realtek|Medion|Acer|Shuttle|Shenzhen Madigi|Minisforum|Beelink|Intel\b|Microsoft/i, kind: 'pc', label: 'PC-Hersteller' },
  { pattern: /Super Micro|Supermicro/i, kind: 'server', label: 'Serverhersteller' },
];

function classify(device: Omit<ScanDevice, 'kind' | 'confidence' | 'reasons'>, gateway: string | undefined, selfIps: string[]): Pick<ScanDevice, 'kind' | 'confidence' | 'reasons' | 'os'> {
  const reasons: string[] = [];
  const ports = new Set((device.ports ?? []).map((port) => port.port));
  const has = (...list: number[]) => list.some((port) => ports.has(port));
  const text = [device.hostname, ...(device.ports ?? []).flatMap((port) => [port.product, port.title])].filter(Boolean).join(' ');
  const os = (device.ports ?? []).map((port) => port.ostype).find(Boolean);
  const vendorRule = device.vendor ? VENDOR_RULES.find((rule) => rule.pattern.test(device.vendor!)) : undefined;
  const name = device.hostname?.toLowerCase() ?? '';

  const short = name.split('.')[0];
  const printerName = /^(canon|hp[0-9a-f]{6}|npi[0-9a-f]|brw|brn|km[a-z]?\d|kmb|epson|ricoh|xerox|lexmark|kyocera|konica|drucker|printer|prn)/.test(short);

  if (selfIps.includes(device.ip)) return { kind: 'self', confidence: 'high', reasons: ['dieser Rechner'], os };
  if (device.ip === gateway) return { kind: 'router', confidence: 'high', reasons: ['Standard-Gateway'], os };

  if (has(8006) || /proxmox/i.test(text) || /^pve/.test(name)) {
    reasons.push(has(8006) ? 'Port 8006 (Proxmox-Weboberfläche)' : 'Name deutet auf Proxmox');
    return { kind: 'hypervisor', confidence: 'high', reasons, os };
  }
  if (has(9100, 515, 631) || printerName || /printer|laserjet|officejet|imagerunner|bizhub|ecosys|workcentre|drucker/i.test(text)) {
    if (printerName) reasons.push(`Gerätename ${short} (typisch für Drucker)`);
    if (has(9100)) reasons.push('Port 9100 (Raw-Druck)');
    if (has(631)) reasons.push('Port 631 (IPP)');
    if (has(515)) reasons.push('Port 515 (LPD)');
    if (/printer|laserjet|officejet|imagerunner|bizhub|ecosys|workcentre|drucker/i.test(text) && !printerName) reasons.push('Name/Webseite nennt Drucker');
    if (vendorRule?.kind === 'printer') reasons.push(`${vendorRule.label}: ${device.vendor}`);
    return { kind: 'printer', confidence: reasons.length > 1 ? 'high' : 'medium', reasons, os };
  }
  if (has(554) || vendorRule?.kind === 'camera') {
    reasons.push(has(554) ? 'Port 554 (RTSP-Video)' : `${vendorRule!.label}: ${device.vendor}`);
    return { kind: 'camera', confidence: 'medium', reasons, os };
  }
  if (has(5060, 5061) || vendorRule?.kind === 'phone') {
    reasons.push(has(5060, 5061) ? 'SIP-Port (Telefonie)' : `${vendorRule!.label}: ${device.vendor}`);
    return { kind: 'phone', confidence: 'medium', reasons, os };
  }
  if (vendorRule?.kind === 'nas' || (has(5000, 5001) && has(445))) {
    reasons.push(vendorRule?.kind === 'nas' ? `${vendorRule.label}: ${device.vendor}` : 'Ports 5000/5001 + SMB');
    return { kind: 'nas', confidence: 'medium', reasons, os };
  }
  if (device.mac?.startsWith('00:15:5d')) {
    reasons.push('Hyper-V-Netzwerkkarte (00:15:5D)');
    if (/^(dc\d|srv|file|sql|veeam|backup|exchange|mail)|srv|sql/.test(short)) reasons.push(`Name ${short} deutet auf Server`);
    return { kind: 'vm', confidence: 'high', reasons, os: os ?? 'Windows' };
  }
  if (vendorRule?.kind === 'vm') {
    reasons.push(`${vendorRule.label}: ${device.vendor}`);
    if (has(3389) || /windows/i.test(os ?? '')) reasons.push('Windows-Dienste');
    else if (has(22)) reasons.push('SSH offen');
    return { kind: 'vm', confidence: 'high', reasons, os };
  }
  if (vendorRule?.kind === 'network' || (has(23, 161) && !has(22, 445, 3389))) {
    reasons.push(vendorRule?.kind === 'network' ? `${vendorRule.label}: ${device.vendor}` : 'nur Verwaltungsports (Telnet/SNMP)');
    return { kind: 'network', confidence: vendorRule ? 'high' : 'low', reasons, os };
  }

  const windows = has(135, 139, 445, 3389) || /windows/i.test(os ?? '');
  const domainController = has(88) && has(389);
  if (domainController) {
    reasons.push('Kerberos + LDAP (Domänencontroller)');
    return { kind: 'server', confidence: 'high', reasons, os: os ?? 'Windows' };
  }
  const serverPorts = [21, 25, 53, 80, 110, 143, 443, 1433, 3306, 5432, 6379, 8080, 8443, 9000, 27017].filter((port) => ports.has(port));
  if (/srv|server|dc\d|sql|mail|web|app|db/.test(name)) reasons.push('Name deutet auf Server');
  if (windows) {
    if (has(3389)) reasons.push('RDP (3389)');
    if (has(445)) reasons.push('SMB (445)');
    if (serverPorts.length >= 2 || /srv|server/.test(name)) {
      reasons.push(`Serverdienste: ${serverPorts.join(', ') || '–'}`);
      return { kind: 'server', confidence: 'medium', reasons, os: os ?? 'Windows' };
    }
    if (vendorRule?.kind === 'pc') reasons.push(`${vendorRule.label}: ${device.vendor}`);
    return { kind: 'pc', confidence: vendorRule?.kind === 'pc' ? 'high' : 'medium', reasons, os: os ?? 'Windows' };
  }
  if (has(22) && (serverPorts.length > 0 || /linux|unix/i.test(os ?? ''))) {
    reasons.push('SSH', ...(serverPorts.length ? [`Dienste: ${serverPorts.join(', ')}`] : []));
    return { kind: 'server', confidence: 'medium', reasons, os: os ?? 'Linux' };
  }
  if (vendorRule?.kind === 'printer') {
    reasons.push(`${vendorRule.label}: ${device.vendor}`);
    return { kind: 'printer', confidence: 'medium', reasons, os };
  }
  if (has(62078) || vendorRule?.kind === 'mobile' || device.randomMac) {
    if (has(62078)) reasons.push('Port 62078 (iPhone/iPad)');
    if (vendorRule?.kind === 'mobile') reasons.push(`${vendorRule.label}: ${device.vendor}`);
    if (device.randomMac) reasons.push('zufällige MAC (typisch für Smartphones/Laptops)');
    return { kind: 'mobile', confidence: has(62078) ? 'high' : 'low', reasons, os };
  }
  if (vendorRule?.kind === 'iot') {
    reasons.push(`${vendorRule.label}: ${device.vendor}`);
    return { kind: 'iot', confidence: 'medium', reasons, os };
  }
  if (vendorRule?.kind === 'pc' || has(22, 5900)) {
    reasons.push(vendorRule?.kind === 'pc' ? `${vendorRule.label}: ${device.vendor}` : has(22) ? 'SSH offen' : 'VNC offen');
    return { kind: 'pc', confidence: vendorRule?.kind === 'pc' && !device.ports ? 'medium' : 'low', reasons, os };
  }
  if (vendorRule?.kind === 'server') {
    reasons.push(`${vendorRule.label}: ${device.vendor}`);
    return { kind: 'server', confidence: 'low', reasons, os };
  }
  if (serverPorts.length) {
    reasons.push(`Dienste: ${serverPorts.join(', ')}`);
    return { kind: 'server', confidence: 'low', reasons, os };
  }
  if (device.vendor) reasons.push(`Hersteller: ${device.vendor}`);
  if (!device.ports) reasons.push('für eine Zuordnung Quick-Scan starten');
  else if (!device.ports.length) reasons.push('keine offenen Ports unter den Top 100');
  return { kind: 'unknown', confidence: 'low', reasons, os };
}

/* ---------- job runner ---------- */

const DATA_FILE = path.join(process.cwd(), 'data', 'network-scan.json');
let current: { job: ScanJob; child?: ChildProcess; cancelled?: boolean } | null = null;
let last: ScanJob | null = null;

async function loadLast() {
  if (last) return last;
  try {
    last = JSON.parse(await readFile(DATA_FILE, 'utf8')) as ScanJob;
  } catch {
    last = null;
  }
  return last;
}

/**
 * Runs nmap with XML written to a temp file (XML on a pipe is only flushed at the end).
 * Progress comes from the "About 12.34% done" stats lines, or from elapsed vs. expected time.
 */
function runNmap(job: ScanJob, args: string[], share: [number, number], expectedSeconds: number, onTick?: () => void): Promise<string> {
  return new Promise((resolve, reject) => {
    if (current?.cancelled) return reject(new Error('cancelled'));
    const xmlFile = path.join(os.tmpdir(), `sar-nmap-${job.id}-${Date.now()}.xml`);
    const child = spawn('nmap', [...args, '--stats-every', '2s', '-oX', xmlFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    if (current) current.child = child;
    const started = Date.now();
    const setProgress = (fraction: number) => {
      job.progress = Math.max(job.progress, share[0] + (share[1] - share[0]) * Math.min(fraction, 0.97));
    };
    const timer = setInterval(() => {
      setProgress((Date.now() - started) / 1000 / expectedSeconds);
      onTick?.();
    }, 1500);
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      const percents = [...chunk.toString().matchAll(/About ([\d.]+)% done/g)].map((match) => Number(match[1]));
      if (percents.length) setProgress(percents[percents.length - 1] / 100);
    });
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', (error) => {
      clearInterval(timer);
      reject(new Error(`nmap konnte nicht gestartet werden: ${error.message}`));
    });
    child.on('close', async (code, signal) => {
      clearInterval(timer);
      const xml = await readFile(xmlFile, 'utf8').catch(() => '');
      await rm(xmlFile, { force: true }).catch(() => undefined);
      if (signal) return reject(new Error('cancelled'));
      if (code !== 0) return reject(new Error(stderr.trim().split('\n').slice(-2).join(' ') || `nmap exit ${code}`));
      job.progress = share[1];
      resolve(xml);
    });
  });
}

function neighbours(): Promise<Array<{ ip: string; mac: string }>> {
  return new Promise((resolve) => {
    execFile('ip', ['-j', '-4', 'neigh', 'show'], (error, stdout) => {
      if (error) return resolve([]);
      try {
        const list = JSON.parse(stdout) as Array<{ dst: string; lladdr?: string; state?: string[] }>;
        resolve(list.filter((entry) => entry.lladdr && !(entry.state ?? []).some((state) => state === 'FAILED' || state === 'INCOMPLETE')).map((entry) => ({ ip: entry.dst, mac: entry.lladdr!.toLowerCase() })));
      } catch {
        resolve([]);
      }
    });
  });
}

function defaultGateway(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('ip', ['-j', '-4', 'route', 'show', 'default'], (error, stdout) => {
      if (error) return resolve(undefined);
      try {
        resolve((JSON.parse(stdout) as Array<{ gateway?: string }>)[0]?.gateway);
      } catch {
        resolve(undefined);
      }
    });
  });
}

function inSubnet(ip: string, cidr: string) {
  const [network, prefix] = cidr.split('/');
  const mask = Number(prefix) === 0 ? 0 : (~0 << (32 - Number(prefix))) >>> 0;
  return ((toInt(ip) & mask) >>> 0) === ((toInt(network) & mask) >>> 0);
}

// Few probe ports keep the sweep fast; every address gets an ARP request anyway, which finds the rest
const DISCOVERY_PROBES = '-PS22,80,443,445,3389';

const addressCount = (cidr: string) => 2 ** (32 - Number(cidr.split('/')[1]));

async function execute(job: ScanJob) {
  const selfIps = Object.values(os.networkInterfaces()).flatMap((list) => (list ?? []).filter((entry) => entry.family === 'IPv4' && !entry.internal).map((entry) => entry.address));
  const gateway = await defaultGateway();
  try {
    job.phase = 'discover';
    // The neighbour table holds at most ~1024 entries and drops old ones while 1024 addresses are probed,
    // so it is sampled during the sweep instead of only at the end
    const macs = new Map<string, string>();
    const sample = () => void neighbours().then((list) => list.forEach((entry) => macs.set(entry.ip, entry.mac)));
    const discoverXml = await runNmap(job, ['-sn', '-T4', DISCOVERY_PROBES, job.subnet], [0, job.mode === 'quick' ? 25 : 100], Math.max(5, addressCount(job.subnet) * 0.04), sample);
    (await neighbours()).forEach((entry) => macs.set(entry.ip, entry.mac));
    const found = new Map<string, ScanDevice>();
    for (const host of parseHosts(discoverXml)) {
      if (host.up) found.set(host.ip, { ip: host.ip, hostname: host.hostname, kind: 'unknown', confidence: 'low', reasons: [] });
    }
    // Hosts that answered ARP but no TCP probe still exist (firewalled PCs, phones)
    for (const [ip, mac] of macs) {
      if (!inSubnet(ip, job.subnet)) continue;
      const device = found.get(ip) ?? { ip, kind: 'unknown' as DeviceKind, confidence: 'low' as const, reasons: [] };
      device.mac = mac;
      device.vendor = vendorOf(mac);
      device.randomMac = isRandomMac(mac) && !device.vendor;
      found.set(ip, device);
    }
    selfIps.filter((ip) => inSubnet(ip, job.subnet)).forEach((ip) => found.set(ip, { ...(found.get(ip) ?? { ip, kind: 'self', confidence: 'high', reasons: [] }), hostname: found.get(ip)?.hostname ?? os.hostname() }));

    if (job.mode === 'quick' && found.size) {
      job.phase = 'ports';
      const targets = [...found.keys()].filter((ip) => !selfIps.includes(ip));
      const portsXml = await runNmap(
        job,
        ['-T4', '-Pn', '-F', '--open', '-sV', '--version-light', '--max-retries', '1', '--host-timeout', '90s', '--script', 'http-title', ...targets],
        [25, 100],
        Math.max(30, targets.length * 1.2),
      );
      for (const host of parseHosts(portsXml)) {
        const device = found.get(host.ip);
        if (!device) continue;
        device.ports = host.ports;
        device.hostname = device.hostname ?? host.hostname;
      }
      targets.forEach((ip) => (found.get(ip)!.ports ??= []));
    }

    job.devices = [...found.values()]
      .map((device) => ({ ...device, ...classify(device, gateway, selfIps) }))
      .sort((left, right) => toInt(left.ip) - toInt(right.ip));
    job.phase = 'done';
    job.progress = 100;
  } catch (error: any) {
    job.phase = error.message === 'cancelled' ? 'cancelled' : 'failed';
    job.error = error.message === 'cancelled' ? undefined : error.message;
  } finally {
    job.finishedAt = new Date().toISOString();
    if (job.phase === 'done') {
      last = job;
      await mkdir(path.dirname(DATA_FILE), { recursive: true }).catch(() => undefined);
      await writeFile(DATA_FILE, JSON.stringify(job)).catch(() => undefined);
    }
    if (current?.job === job) current = null;
  }
}

export function startScan(subnet: string, mode: 'discover' | 'quick'): ScanJob {
  if (current) throw new Error('Es läuft bereits ein Scan');
  const job: ScanJob = { id: `${Date.now()}`, subnet, mode, phase: 'discover', progress: 0, startedAt: new Date().toISOString(), devices: [] };
  current = { job };
  void execute(job);
  return job;
}

export function cancelScan() {
  if (!current) return false;
  current.cancelled = true;
  current.child?.kill('SIGTERM');
  return true;
}

export async function scanState() {
  return { running: current?.job ?? null, last: await loadLast() };
}
