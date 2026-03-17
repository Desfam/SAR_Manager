type MetricSample = {
  name: string;
  labels: Record<string, string>;
  value: number;
};

export type NodeExporterSystemMetrics = {
  timestamp: string;
  source: 'node_exporter';
  systemInfo: {
    hostname: string;
    uptime: string;
    uptimeSeconds: number;
    os: string;
    kernel: string;
  };
  cpu: {
    count: number;
    usage: number;
    user: number;
    system: number;
  };
  memory: {
    total: number;
    used: number;
    available: number;
    percentUsed: number;
  };
  disk: {
    total: number;
    used: number;
    available: number;
    percentUsed: number;
    path: string;
  };
  loadAverage: {
    one: number;
    five: number;
    fifteen: number;
  };
  network: Array<{
    name: string;
    rxBytes: number;
    txBytes: number;
  }>;
  temperatures: Array<{
    sensor: string;
    celsius: number;
  }>;
  networkRates?: {
    rxRate: number;
    txRate: number;
  };
  diskIO?: {
    readRate: number;
    writeRate: number;
  };
};

export type NodeExporterIORates = {
  networkRates: {
    rxRate: number; // bytes/sec aggregate received
    txRate: number; // bytes/sec aggregate transmitted
  };
  diskIO: {
    readRate: number;  // bytes/sec aggregate disk reads
    writeRate: number; // bytes/sec aggregate disk writes
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePrometheusText(text: string): MetricSample[] {
  const samples: MetricSample[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const braceIndex = line.indexOf('{');
    if (braceIndex >= 0) {
      const closeIndex = line.indexOf('}', braceIndex);
      if (closeIndex < 0) continue;

      const name = line.slice(0, braceIndex);
      const labelsText = line.slice(braceIndex + 1, closeIndex);
      const valueText = line.slice(closeIndex + 1).trim().split(/\s+/)[0];
      const value = Number(valueText);
      if (!Number.isFinite(value)) continue;

      const labels: Record<string, string> = {};
      const labelRegex = /(\w+)="([^"]*)"/g;
      let match: RegExpExecArray | null;
      while ((match = labelRegex.exec(labelsText)) !== null) {
        labels[match[1]] = match[2];
      }

      samples.push({ name, labels, value });
      continue;
    }

    const [name, valueText] = line.split(/\s+/, 2);
    if (!name || valueText === undefined) continue;
    const value = Number(valueText);
    if (!Number.isFinite(value)) continue;
    samples.push({ name, labels: {}, value });
  }

  return samples;
}

function filterSamples(
  samples: MetricSample[],
  metricName: string,
  expectedLabels: Record<string, string> = {}
): MetricSample[] {
  return samples.filter((sample) => {
    if (sample.name !== metricName) return false;
    return Object.entries(expectedLabels).every(
      ([k, v]) => sample.labels[k] === v
    );
  });
}

function firstValue(
  samples: MetricSample[],
  metricName: string,
  expectedLabels: Record<string, string> = {},
  fallback = 0
): number {
  const hit = filterSamples(samples, metricName, expectedLabels)[0];
  return hit ? hit.value : fallback;
}

function preferredRootFsSample(samples: MetricSample[], metricName: string): MetricSample | undefined {
  const rootSamples = filterSamples(samples, metricName, { mountpoint: '/' });
  if (rootSamples.length === 0) return undefined;

  // Prefer actual block-backed filesystems over pseudo filesystems.
  return (
    rootSamples.find((s) => {
      const fs = s.labels.fstype || '';
      return fs !== 'tmpfs' && fs !== 'overlay' && fs !== 'squashfs';
    }) || rootSamples[0]
  );
}

function formatUptime(uptimeSeconds: number): string {
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function parseCpuUsagePercent(
  snapA: MetricSample[],
  snapB: MetricSample[],
  intervalSeconds: number
): { usage: number; user: number; system: number; count: number } {
  const idleA = filterSamples(snapA, 'node_cpu_seconds_total', { mode: 'idle' });
  const idleB = filterSamples(snapB, 'node_cpu_seconds_total', { mode: 'idle' });
  const userA = filterSamples(snapA, 'node_cpu_seconds_total', { mode: 'user' });
  const userB = filterSamples(snapB, 'node_cpu_seconds_total', { mode: 'user' });
  const systemA = filterSamples(snapA, 'node_cpu_seconds_total', { mode: 'system' });
  const systemB = filterSamples(snapB, 'node_cpu_seconds_total', { mode: 'system' });

  const cpuCount = Math.max(
    1,
    new Set(
      filterSamples(snapB, 'node_cpu_seconds_total').map((s) => s.labels.cpu)
    ).size
  );

  const idleDelta = idleB.reduce((acc, b) => {
    const a = idleA.find((v) => v.labels.cpu === b.labels.cpu);
    if (!a) return acc;
    return acc + Math.max(0, b.value - a.value);
  }, 0);

  const userDelta = userB.reduce((acc, b) => {
    const a = userA.find((v) => v.labels.cpu === b.labels.cpu);
    if (!a) return acc;
    return acc + Math.max(0, b.value - a.value);
  }, 0);

  const systemDelta = systemB.reduce((acc, b) => {
    const a = systemA.find((v) => v.labels.cpu === b.labels.cpu);
    if (!a) return acc;
    return acc + Math.max(0, b.value - a.value);
  }, 0);

  const totalCoreSeconds = Math.max(0.0001, cpuCount * intervalSeconds);
  const idlePct = (idleDelta / totalCoreSeconds) * 100;
  const userPct = (userDelta / totalCoreSeconds) * 100;
  const systemPct = (systemDelta / totalCoreSeconds) * 100;
  const usagePct = Math.max(0, Math.min(100, 100 - idlePct));

  return {
    usage: usagePct,
    user: Math.max(0, userPct),
    system: Math.max(0, systemPct),
    count: cpuCount,
  };
}

export async function collectNodeExporterSystemMetrics(
  baseUrl: string
): Promise<NodeExporterSystemMetrics> {
  const url = baseUrl.endsWith('/metrics') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/metrics`;

  const firstResp = await fetch(url);
  if (!firstResp.ok) {
    throw new Error(`node_exporter scrape failed with HTTP ${firstResp.status}`);
  }
  const firstText = await firstResp.text();
  const firstSnap = parsePrometheusText(firstText);

  // A short second sample enables CPU usage calculation from cumulative counters.
  await sleep(700);

  const secondResp = await fetch(url);
  if (!secondResp.ok) {
    throw new Error(`node_exporter second scrape failed with HTTP ${secondResp.status}`);
  }
  const secondText = await secondResp.text();
  const secondSnap = parsePrometheusText(secondText);

  const cpu = parseCpuUsagePercent(firstSnap, secondSnap, 0.7);

  const memTotal = firstValue(secondSnap, 'node_memory_MemTotal_bytes');
  const memAvail = firstValue(secondSnap, 'node_memory_MemAvailable_bytes');
  const memUsed = Math.max(0, memTotal - memAvail);
  const memPercent = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;

  const fsSizeSample = preferredRootFsSample(secondSnap, 'node_filesystem_size_bytes');
  const fsAvailSample = preferredRootFsSample(secondSnap, 'node_filesystem_avail_bytes');
  const diskTotal = fsSizeSample?.value || 0;
  const diskAvail = fsAvailSample?.value || 0;
  const diskUsed = Math.max(0, diskTotal - diskAvail);
  const diskPercent = diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0;

  const network = filterSamples(secondSnap, 'node_network_receive_bytes_total')
    .filter((s) => s.labels.device && s.labels.device !== 'lo')
    .map((rx) => {
      const device = rx.labels.device;
      const tx = filterSamples(secondSnap, 'node_network_transmit_bytes_total', {
        device,
      })[0];
      return {
        name: device,
        rxBytes: rx.value,
        txBytes: tx?.value || 0,
      };
    })
    .sort((a, b) => b.rxBytes + b.txBytes - (a.rxBytes + a.txBytes))
    .slice(0, 5);

  // Network IO rates – delta between the two scrapes (0.7 s interval)
  // Prefer real Ethernet/WiFi interfaces; fall back to all non-lo when none found.
  const SKIP_NET = /^(lo|veth|docker|br-|virbr|tun|tap|vmbr)/;
  const PHYS_NET = /^(eth|ens|eno|enp|em|wlan|wlp|bond)/;
  const allNetRx = filterSamples(secondSnap, 'node_network_receive_bytes_total')
    .filter((s) => s.labels.device && !SKIP_NET.test(s.labels.device));
  const preferredNetRx = allNetRx.filter((s) => PHYS_NET.test(s.labels.device || ''));
  const netRxSamples = preferredNetRx.length > 0 ? preferredNetRx : allNetRx;

  let totalNetRxRate = 0;
  let totalNetTxRate = 0;
  for (const rxB of netRxSamples) {
    const dev = rxB.labels.device;
    const rxA = firstValue(firstSnap, 'node_network_receive_bytes_total', { device: dev });
    const txA = firstValue(firstSnap, 'node_network_transmit_bytes_total', { device: dev });
    const txB = firstValue(secondSnap, 'node_network_transmit_bytes_total', { device: dev });
    totalNetRxRate += Math.max(0, rxB.value - rxA) / 0.7;
    totalNetTxRate += Math.max(0, txB - txA) / 0.7;
  }

  // Disk IO rates – prefer physical block devices (sd*, nvme*, vd*, xvd*)
  // In LXC containers these may report host disks; still useful as throughput indicator.
  const PHYS_DISK = /^(sd|hd|nvme|vd|xvd|mmcblk)/;
  const allDiskRead = filterSamples(secondSnap, 'node_disk_read_bytes_total');
  const physDiskRead = allDiskRead.filter((s) => PHYS_DISK.test(s.labels.device || ''));
  const diskSamples = physDiskRead.length > 0 ? physDiskRead : allDiskRead.slice(0, 5);

  let totalDiskReadRate = 0;
  let totalDiskWriteRate = 0;
  for (const readB of diskSamples) {
    const dev = readB.labels.device;
    const readA = firstValue(firstSnap, 'node_disk_read_bytes_total', { device: dev });
    const writeA = firstValue(firstSnap, 'node_disk_written_bytes_total', { device: dev });
    const writeB = firstValue(secondSnap, 'node_disk_written_bytes_total', { device: dev });
    totalDiskReadRate += Math.max(0, readB.value - readA) / 0.7;
    totalDiskWriteRate += Math.max(0, writeB - writeA) / 0.7;
  }

  const temperatures = filterSamples(secondSnap, 'node_hwmon_temp_celsius')
    .map((s) => ({
      sensor: `${s.labels.chip || 'chip'}:${s.labels.sensor || 'temp'}`,
      celsius: s.value,
    }))
    .sort((a, b) => b.celsius - a.celsius)
    .slice(0, 8);

  const uptimeSeconds = Math.max(
    0,
    firstValue(secondSnap, 'node_time_seconds') - firstValue(secondSnap, 'node_boot_time_seconds')
  );

  const uname = filterSamples(secondSnap, 'node_uname_info')[0];
  const osInfo = filterSamples(secondSnap, 'node_os_info')[0];

  return {
    timestamp: new Date().toISOString(),
    source: 'node_exporter',
    systemInfo: {
      hostname: uname?.labels.nodename || 'unknown',
      uptime: formatUptime(uptimeSeconds),
      uptimeSeconds,
      os: osInfo?.labels.pretty_name || osInfo?.labels.name || 'Linux',
      kernel: uname?.labels.release || 'unknown',
    },
    cpu: {
      count: cpu.count,
      usage: cpu.usage,
      user: cpu.user,
      system: cpu.system,
    },
    memory: {
      total: memTotal,
      used: memUsed,
      available: memAvail,
      percentUsed: memPercent,
    },
    disk: {
      total: diskTotal,
      used: diskUsed,
      available: diskAvail,
      percentUsed: diskPercent,
      path: '/',
    },
    loadAverage: {
      one: firstValue(secondSnap, 'node_load1'),
      five: firstValue(secondSnap, 'node_load5'),
      fifteen: firstValue(secondSnap, 'node_load15'),
    },
    network,
    temperatures,
    networkRates: {
      rxRate: totalNetRxRate,
      txRate: totalNetTxRate,
    },
    diskIO: {
      readRate: totalDiskReadRate,
      writeRate: totalDiskWriteRate,
    },
  };
}