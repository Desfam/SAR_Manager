import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { alertsDb, connectionDb, metricsDb, plannerDb } from '../services/database.js';

const router = Router();

type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
type TaskStatus = 'todo' | 'in_progress' | 'done';

function safeJsonArray(value: unknown): string[] {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function normalizeTask(row: any) {
  return {
    ...row,
    tags: safeJsonArray(row.tags),
  };
}

function normalizeEvent(row: any) {
  return {
    ...row,
    checklist: safeJsonArray(row.checklist),
    attachments: safeJsonArray(row.attachments),
  };
}

function normalizeNote(row: any) {
  return {
    ...row,
    tags: safeJsonArray(row.tags),
  };
}

function isoDayRange(date: Date) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function parseTaskPriority(value: unknown): TaskPriority {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'critical') {
    return value;
  }
  return 'medium';
}

function parseTaskStatus(value: unknown): TaskStatus {
  if (value === 'todo' || value === 'in_progress' || value === 'done') {
    return value;
  }
  return 'todo';
}

router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const { start, end } = isoDayRange(now);

    const tasks = plannerDb.listTasks().map(normalizeTask);
    const eventsToday = plannerDb.listEventsInRange(start, end).map(normalizeEvent);
    const upcomingEvents = plannerDb.listUpcomingEvents(5).map(normalizeEvent);
    const quickLinks = plannerDb.listQuickLinks();

    const tasksToday = tasks.filter((task) => !!task.deadline && task.deadline >= start && task.deadline <= end);
    const openTasks = tasks.filter((task) => task.status !== 'done');
    const doneTasks = tasks.filter((task) => task.status === 'done');

    const prioritySummary = {
      low: openTasks.filter((task) => task.priority === 'low').length,
      medium: openTasks.filter((task) => task.priority === 'medium').length,
      high: openTasks.filter((task) => task.priority === 'high').length,
      critical: openTasks.filter((task) => task.priority === 'critical').length,
    };

    const connections: any[] = connectionDb.getAll();
    const serverItems = connections.map((connection) => {
      const latestMetrics: any = metricsDb.getLatest(connection.id);
      return {
        id: connection.id,
        name: connection.name,
        status: connection.status,
        cpu: latestMetrics?.cpu_usage ?? null,
        memory: latestMetrics?.memory_usage ?? null,
        disk: latestMetrics?.disk_usage ?? null,
      };
    });

    const activeAlerts = alertsDb.getActive().slice(0, 10);

    const progressTotal = tasks.length;
    const progressDone = doneTasks.length;
    const progressPercent = progressTotal > 0 ? (progressDone / progressTotal) * 100 : 0;

    res.json({
      timestamp: now.toISOString(),
      today: {
        eventsCount: eventsToday.length,
        tasksDueCount: tasksToday.length,
        openTasksCount: openTasks.length,
      },
      events: {
        today: eventsToday,
        upcoming: upcomingEvents,
      },
      tasks: {
        today: tasksToday,
        open: openTasks,
        prioritySummary,
        progress: {
          total: progressTotal,
          done: progressDone,
          percent: Number(progressPercent.toFixed(1)),
        },
      },
      servers: {
        total: serverItems.length,
        online: serverItems.filter((item) => item.status === 'online').length,
        offline: serverItems.filter((item) => item.status !== 'online').length,
        items: serverItems,
      },
      quickLinks,
      alerts: activeAlerts,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const tasks = plannerDb.listTasks(status).map(normalizeTask);
    res.json(tasks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const title = String(req.body?.title || '').trim();
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const id = randomUUID();
    plannerDb.createTask({
      id,
      title,
      description: typeof req.body?.description === 'string' ? req.body.description : undefined,
      priority: parseTaskPriority(req.body?.priority),
      deadline: typeof req.body?.deadline === 'string' ? req.body.deadline : null,
      status: parseTaskStatus(req.body?.status),
      tags: Array.isArray(req.body?.tags) ? req.body.tags.map((tag: unknown) => String(tag)) : [],
      linkedEventId: typeof req.body?.linkedEventId === 'string' ? req.body.linkedEventId : null,
      linkedNoteId: typeof req.body?.linkedNoteId === 'string' ? req.body.linkedNoteId : null,
    });

    const created = plannerDb.getTaskById(id);
    res.status(201).json(normalizeTask(created));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const existing: any = plannerDb.getTaskById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const mergedTitle = req.body?.title !== undefined ? String(req.body.title).trim() : existing.title;
    if (!mergedTitle) {
      return res.status(400).json({ error: 'title cannot be empty' });
    }

    plannerDb.updateTask(req.params.id, {
      title: mergedTitle,
      description: req.body?.description !== undefined ? String(req.body.description) : existing.description,
      priority: req.body?.priority !== undefined ? parseTaskPriority(req.body.priority) : existing.priority,
      deadline: req.body?.deadline !== undefined ? (req.body.deadline ? String(req.body.deadline) : null) : existing.deadline,
      status: req.body?.status !== undefined ? parseTaskStatus(req.body.status) : existing.status,
      tags: req.body?.tags !== undefined
        ? (Array.isArray(req.body.tags) ? req.body.tags.map((tag: unknown) => String(tag)) : [])
        : safeJsonArray(existing.tags),
      linkedEventId: req.body?.linkedEventId !== undefined ? (req.body.linkedEventId ? String(req.body.linkedEventId) : null) : existing.linked_event_id,
      linkedNoteId: req.body?.linkedNoteId !== undefined ? (req.body.linkedNoteId ? String(req.body.linkedNoteId) : null) : existing.linked_note_id,
    });

    const updated = plannerDb.getTaskById(req.params.id);
    res.json(normalizeTask(updated));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const deleted = plannerDb.deleteTask(req.params.id);
    if (!deleted.changes) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/events', async (req: Request, res: Response) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const events = plannerDb.listEventsInRange(from, to).map(normalizeEvent);
    res.json(events);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/events', async (req: Request, res: Response) => {
  try {
    const title = String(req.body?.title || '').trim();
    const startAt = String(req.body?.startAt || '').trim();

    if (!title || !startAt) {
      return res.status(400).json({ error: 'title and startAt are required' });
    }

    const id = randomUUID();
    plannerDb.createEvent({
      id,
      title,
      startAt,
      endAt: typeof req.body?.endAt === 'string' ? req.body.endAt : null,
      description: typeof req.body?.description === 'string' ? req.body.description : undefined,
      checklist: Array.isArray(req.body?.checklist) ? req.body.checklist.map((item: unknown) => String(item)) : [],
      attachments: Array.isArray(req.body?.attachments) ? req.body.attachments.map((item: unknown) => String(item)) : [],
      linkedTaskId: typeof req.body?.linkedTaskId === 'string' ? req.body.linkedTaskId : null,
      linkedNoteId: typeof req.body?.linkedNoteId === 'string' ? req.body.linkedNoteId : null,
    });

    const created = plannerDb.getEventById(id);
    res.status(201).json(normalizeEvent(created));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/events/:id', async (req: Request, res: Response) => {
  try {
    const existing: any = plannerDb.getEventById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const mergedTitle = req.body?.title !== undefined ? String(req.body.title).trim() : existing.title;
    const mergedStart = req.body?.startAt !== undefined ? String(req.body.startAt).trim() : existing.start_at;

    if (!mergedTitle || !mergedStart) {
      return res.status(400).json({ error: 'title and startAt cannot be empty' });
    }

    plannerDb.updateEvent(req.params.id, {
      title: mergedTitle,
      startAt: mergedStart,
      endAt: req.body?.endAt !== undefined ? (req.body.endAt ? String(req.body.endAt) : null) : existing.end_at,
      description: req.body?.description !== undefined ? String(req.body.description) : existing.description,
      checklist: req.body?.checklist !== undefined
        ? (Array.isArray(req.body.checklist) ? req.body.checklist.map((item: unknown) => String(item)) : [])
        : safeJsonArray(existing.checklist),
      attachments: req.body?.attachments !== undefined
        ? (Array.isArray(req.body.attachments) ? req.body.attachments.map((item: unknown) => String(item)) : [])
        : safeJsonArray(existing.attachments),
      linkedTaskId: req.body?.linkedTaskId !== undefined ? (req.body.linkedTaskId ? String(req.body.linkedTaskId) : null) : existing.linked_task_id,
      linkedNoteId: req.body?.linkedNoteId !== undefined ? (req.body.linkedNoteId ? String(req.body.linkedNoteId) : null) : existing.linked_note_id,
    });

    const updated = plannerDb.getEventById(req.params.id);
    res.json(normalizeEvent(updated));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/events/:id', async (req: Request, res: Response) => {
  try {
    const deleted = plannerDb.deleteEvent(req.params.id);
    if (!deleted.changes) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/notes', async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const notes = plannerDb.listNotes(q).map(normalizeNote);
    res.json(notes);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/notes', async (req: Request, res: Response) => {
  try {
    const title = String(req.body?.title || '').trim();
    const content = String(req.body?.content || '');

    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    const id = randomUUID();
    plannerDb.createNote({
      id,
      title,
      content,
      tags: Array.isArray(req.body?.tags) ? req.body.tags.map((tag: unknown) => String(tag)) : [],
      folder: typeof req.body?.folder === 'string' ? req.body.folder : null,
      linkedTaskId: typeof req.body?.linkedTaskId === 'string' ? req.body.linkedTaskId : null,
      linkedEventId: typeof req.body?.linkedEventId === 'string' ? req.body.linkedEventId : null,
      linkedConnectionId: typeof req.body?.linkedConnectionId === 'string' ? req.body.linkedConnectionId : null,
    });

    const created = plannerDb.getNoteById(id);
    res.status(201).json(normalizeNote(created));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/notes/:id', async (req: Request, res: Response) => {
  try {
    const existing: any = plannerDb.getNoteById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const mergedTitle = req.body?.title !== undefined ? String(req.body.title).trim() : existing.title;
    const mergedContent = req.body?.content !== undefined ? String(req.body.content) : existing.content;

    if (!mergedTitle || !mergedContent) {
      return res.status(400).json({ error: 'title and content cannot be empty' });
    }

    plannerDb.updateNote(req.params.id, {
      title: mergedTitle,
      content: mergedContent,
      tags: req.body?.tags !== undefined
        ? (Array.isArray(req.body.tags) ? req.body.tags.map((tag: unknown) => String(tag)) : [])
        : safeJsonArray(existing.tags),
      folder: req.body?.folder !== undefined ? (req.body.folder ? String(req.body.folder) : null) : existing.folder,
      linkedTaskId: req.body?.linkedTaskId !== undefined ? (req.body.linkedTaskId ? String(req.body.linkedTaskId) : null) : existing.linked_task_id,
      linkedEventId: req.body?.linkedEventId !== undefined ? (req.body.linkedEventId ? String(req.body.linkedEventId) : null) : existing.linked_event_id,
      linkedConnectionId: req.body?.linkedConnectionId !== undefined ? (req.body.linkedConnectionId ? String(req.body.linkedConnectionId) : null) : existing.linked_connection_id,
    });

    const updated = plannerDb.getNoteById(req.params.id);
    res.json(normalizeNote(updated));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/notes/:id', async (req: Request, res: Response) => {
  try {
    const deleted = plannerDb.deleteNote(req.params.id);
    if (!deleted.changes) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/quick-links', async (req: Request, res: Response) => {
  try {
    const links = plannerDb.listQuickLinks();
    res.json(links);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/quick-links', async (req: Request, res: Response) => {
  try {
    const name = String(req.body?.name || '').trim();
    const url = String(req.body?.url || '').trim();

    if (!name || !url) {
      return res.status(400).json({ error: 'name and url are required' });
    }

    const id = randomUUID();
    plannerDb.createQuickLink({
      id,
      name,
      url,
      icon: typeof req.body?.icon === 'string' ? req.body.icon : null,
      category: typeof req.body?.category === 'string' ? req.body.category : 'service',
      sortOrder: typeof req.body?.sortOrder === 'number' ? req.body.sortOrder : 0,
    });

    const created = plannerDb.listQuickLinks().find((link: any) => link.id === id);
    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/quick-links/:id', async (req: Request, res: Response) => {
  try {
    const deleted = plannerDb.deleteQuickLink(req.params.id);
    if (!deleted.changes) {
      return res.status(404).json({ error: 'Quick link not found' });
    }
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/search', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({ error: 'q is required' });
    }

    const lowerQuery = q.toLowerCase();

    const tasks = plannerDb
      .listTasks()
      .map(normalizeTask)
      .filter((task) => task.title.toLowerCase().includes(lowerQuery) || String(task.description || '').toLowerCase().includes(lowerQuery));

    const events = plannerDb
      .listEventsInRange()
      .map(normalizeEvent)
      .filter((event) => event.title.toLowerCase().includes(lowerQuery) || String(event.description || '').toLowerCase().includes(lowerQuery));

    const notes = plannerDb.listNotes(q).map(normalizeNote);

    const servers: any[] = connectionDb
      .getAll()
      .filter((connection: any) => connection.name.toLowerCase().includes(lowerQuery) || connection.host.toLowerCase().includes(lowerQuery))
      .map((connection: any) => ({
        id: connection.id,
        name: connection.name,
        host: connection.host,
        status: connection.status,
      }));

    res.json({ tasks, events, notes, servers });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/quick-add', async (req: Request, res: Response) => {
  try {
    const type = String(req.body?.type || '').trim();

    if (type === 'task') {
      const title = String(req.body?.title || '').trim();
      if (!title) {
        return res.status(400).json({ error: 'title is required for task' });
      }

      const id = randomUUID();
      plannerDb.createTask({
        id,
        title,
        priority: parseTaskPriority(req.body?.priority),
        status: parseTaskStatus(req.body?.status),
      });
      return res.status(201).json({ type, item: normalizeTask(plannerDb.getTaskById(id)) });
    }

    if (type === 'event') {
      const title = String(req.body?.title || '').trim();
      const startAt = String(req.body?.startAt || '').trim();
      if (!title || !startAt) {
        return res.status(400).json({ error: 'title and startAt are required for event' });
      }

      const id = randomUUID();
      plannerDb.createEvent({ id, title, startAt });
      return res.status(201).json({ type, item: normalizeEvent(plannerDb.getEventById(id)) });
    }

    if (type === 'note') {
      const title = String(req.body?.title || '').trim();
      const content = String(req.body?.content || '').trim();
      if (!title || !content) {
        return res.status(400).json({ error: 'title and content are required for note' });
      }

      const id = randomUUID();
      plannerDb.createNote({ id, title, content });
      return res.status(201).json({ type, item: normalizeNote(plannerDb.getNoteById(id)) });
    }

    return res.status(400).json({ error: 'type must be one of: task, event, note' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
