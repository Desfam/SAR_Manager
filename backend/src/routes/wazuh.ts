import { Router, Request, Response } from 'express';
import { wazuhEvent, wazuhEvents, wazuhStatus, wazuhSummary, type EventFilters } from '../services/wazuh-indexer.js';
import { managerConfigured, managerInfo } from '../services/wazuh/manager.js';
import { analyzeScan, askFollowUp, claudeStatus, explainEvent } from '../services/wazuh/explain.js';
import { baseline, eventMap, exposure, fullScan, storeBaselineFindings, systemHealth } from '../services/wazuh/analysis.js';
import { addIncidentNote, createIncident, deleteIncident, getIncident, getScan, listFindings, listIncidents, listScans, setFindingStatus, updateIncident } from '../services/wazuh/store.js';
import { dashboard, eventContext, eventHosts, hostContext, hosts, iocLookup, linuxOverview, mitre, searchEvents, trustCenter, userContext, vulnerabilities } from '../services/wazuh/soc.js';

const router: Router = Router();

const text = (value: unknown, max = 200) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined);
const level = (value: unknown) => (value === undefined || value === '' ? undefined : Math.min(Math.max(Number(value) || 0, 0), 16));

function filtersFrom(req: Request): EventFilters {
  return {
    hours: Math.min(Math.max(Number(req.query.hours) || 24, 1), 24 * 365),
    agent: text(req.query.agent, 120),
    agentIp: text(req.query.agentIp, 64),
    minLevel: level(req.query.minLevel),
    maxLevel: level(req.query.maxLevel),
    group: text(req.query.group, 80),
    ruleId: text(req.query.ruleId, 20),
    srcip: text(req.query.srcip, 64),
    q: text(req.query.q),
  };
}

const isoDate = (value: unknown) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined);
const fail = (res: Response, error: any) => res.status(error.status || 500).json({ error: error.message });

router.get('/status', async (_req, res) => {
  try {
    res.json(await wazuhStatus());
  } catch (error) {
    fail(res, error);
  }
});

// Counts, timeline, agents, top rules … (aggregations only, no raw events)
router.get('/summary', async (req, res) => {
  try {
    res.json(await wazuhSummary(filtersFrom(req)));
  } catch (error) {
    fail(res, error);
  }
});

// Newest events first; `after` is the cursor from the previous page
router.get('/events', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    let after: unknown[] | undefined;
    if (typeof req.query.after === 'string') {
      try {
        const parsed = JSON.parse(req.query.after);
        if (Array.isArray(parsed) && parsed.length <= 3) after = parsed;
      } catch {
        return res.status(400).json({ error: 'invalid cursor' });
      }
    }
    return res.json(await wazuhEvents(filtersFrom(req), limit, after));
  } catch (error) {
    return fail(res, error);
  }
});

router.get('/events/:index/:id', async (req, res) => {
  try {
    res.json(await wazuhEvent(req.params.index, req.params.id));
  } catch (error) {
    fail(res, error);
  }
});

/* ---------- SOC workspace ---------- */

const hoursOf = (req: Request, fallback = 24) => Math.min(Math.max(Number(req.query.hours) || fallback, 1), 24 * 90);
const wrap = (handler: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    res.json(await handler(req));
  } catch (error) {
    fail(res, error);
  }
};

router.get('/soc/dashboard', wrap((req) => dashboard(hoursOf(req), level(req.query.minLevel))));
router.get(
  '/soc/search',
  wrap((req) => {
    let after: unknown[] | undefined;
    if (typeof req.query.after === 'string') {
      const parsed = JSON.parse(req.query.after);
      if (Array.isArray(parsed) && parsed.length <= 3) after = parsed;
    }
    return searchEvents({
      q: text(req.query.q, 500) ?? '',
      hours: hoursOf(req),
      limit: Math.min(Math.max(Number(req.query.limit) || 100, 1), 500),
      after,
      order: req.query.order === 'asc' ? 'asc' : 'desc',
      minLevel: level(req.query.minLevel),
      maxLevel: level(req.query.maxLevel),
      from: isoDate(req.query.from),
      to: isoDate(req.query.to),
    });
  }),
);
router.get(
  '/soc/event-hosts',
  wrap((req) => eventHosts({ q: text(req.query.q, 500) ?? '', hours: hoursOf(req), minLevel: level(req.query.minLevel), maxLevel: level(req.query.maxLevel), from: isoDate(req.query.from), to: isoDate(req.query.to) })),
);
router.get('/soc/explain/status', wrap(() => claudeStatus()));
router.post('/soc/scans/:id/analyze', wrap((req) => analyzeScan(req.params.id, req.body?.web !== false, req.ip)));
router.post('/soc/explain/ask', wrap((req) => askFollowUp(String(req.body?.index ?? ''), String(req.body?.id ?? ''), req.body?.history, String(req.body?.question ?? ''), req.body?.web === true)));
router.post('/soc/explain', wrap((req) => explainEvent(String(req.body?.index ?? ''), String(req.body?.id ?? ''), req.body?.refresh === true, req.body?.web === true)));
router.get('/soc/events/:index/:id/context', wrap((req) => eventContext(req.params.index, req.params.id)));
router.get('/soc/hosts', wrap((req) => hosts(hoursOf(req))));
router.get('/soc/hosts/:name', wrap((req) => hostContext(req.params.name, hoursOf(req))));
router.get('/soc/users/:user', wrap((req) => userContext(req.params.user, hoursOf(req))));
router.get('/soc/linux', wrap((req) => linuxOverview(hoursOf(req), text(req.query.category, 30))));
router.get('/soc/mitre', wrap((req) => mitre(hoursOf(req, 24 * 7))));
router.get(
  '/soc/vulnerabilities',
  wrap((req) => vulnerabilities({ severity: text(req.query.severity, 20), host: text(req.query.host, 120), q: text(req.query.q), limit: Math.min(Math.max(Number(req.query.limit) || 100, 1), 500) })),
);
router.get(
  '/soc/ioc',
  wrap((req) => {
    const value = text(req.query.value, 300);
    if (!value) throw Object.assign(new Error('Wert fehlt'), { status: 400 });
    return iocLookup(value, hoursOf(req, 24 * 7));
  }),
);
router.get('/soc/trust', wrap(() => trustCenter()));
/* ---------- round 2: full scan, findings, incidents, baseline, maps, health ---------- */

const hostName = (value: unknown) => {
  const name = text(value, 120);
  if (!name || !/^[\w.\- ]+$/.test(name)) throw Object.assign(new Error('Host fehlt oder ungültig'), { status: 400 });
  return name;
};

router.post('/soc/scan', wrap((req) => fullScan(hostName(req.body?.host), Math.min(Math.max(Number(req.body?.hours) || 24 * 7, 1), 24 * 30))));
router.get('/soc/scans', wrap(async (req) => listScans(text(req.query.host, 120))));
router.get(
  '/soc/scans/:id',
  wrap(async (req) => {
    const scan = getScan(req.params.id);
    if (!scan) throw Object.assign(new Error('Scan not found'), { status: 404 });
    return scan;
  }),
);
router.get('/soc/baseline/:host', wrap((req) => baseline(hostName(req.params.host), Math.min(Math.max(Number(req.query.days) || 7, 1), 30))));
router.post(
  '/soc/baseline/:host/findings',
  wrap(async (req) => {
    const result = await baseline(hostName(req.params.host), Math.min(Math.max(Number(req.body?.days) || 7, 1), 30));
    return storeBaselineFindings(result.findings);
  }),
);

router.get('/soc/findings', wrap(async (req) => listFindings({ host: text(req.query.host, 120), status: text(req.query.status, 20), severity: text(req.query.severity, 20), category: text(req.query.category, 40) })));
router.put('/soc/findings/:id', wrap(async (req) => setFindingStatus(req.params.id, String(req.body?.status ?? ''), req.ip)));

router.get('/soc/incidents', wrap(async (req) => listIncidents({ status: text(req.query.status, 20), host: text(req.query.host, 120) })));
router.post('/soc/incidents', wrap(async (req) => createIncident(req.body ?? {}, req.ip)));
router.get(
  '/soc/incidents/:id',
  wrap(async (req) => {
    const incident = getIncident(req.params.id);
    if (!incident) throw Object.assign(new Error('Incident not found'), { status: 404 });
    return incident;
  }),
);
router.put('/soc/incidents/:id', wrap(async (req) => updateIncident(req.params.id, req.body ?? {}, req.ip)));
router.post('/soc/incidents/:id/notes', wrap(async (req) => addIncidentNote(req.params.id, String(req.body?.text ?? ''), req.ip)));
router.delete('/soc/incidents/:id', wrap(async (req) => deleteIncident(req.params.id, req.ip)));

router.get('/soc/event-map', wrap((req) => eventMap(hoursOf(req), level(req.query.minLevel) ?? 7)));
router.get('/soc/exposure', wrap((req) => exposure(hoursOf(req, 24 * 7))));
router.get('/soc/health', wrap(() => systemHealth()));

// Agent counts from the manager (sidebar status); null when the manager API is not configured
router.get('/soc/fleet', wrap(async () => (managerConfigured() ? managerInfo() : null)));

export default router;
