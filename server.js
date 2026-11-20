'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

const engine = require('./src/engine');
const bus = require('./src/events');
const iconLib = require('./src/icon');
const { getRunner, listRunners } = require('./src/runners');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));

function fail(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
}

function findProject(id) {
  return engine.getState().projects.find((project) => project.id === id) || null;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

app.get('/api/state', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(engine.getState());
});

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  if (res.flushHeaders) res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  res.write('retry: 3000\n\n');
  send('state', engine.getState());

  const onState = (state) => send('state', state);
  const onLog = (entry) => send('log', entry);
  bus.on('state', onState);
  bus.on('log', onLog);

  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off('state', onState);
    bus.off('log', onLog);
  });
});

app.post('/api/projects', (req, res) => {
  const body = req.body || {};
  const rawPath = String(body.path || '').trim();
  if (!rawPath) return fail(res, 400, 'Project path is required');

  let projectPath;
  try {
    projectPath = path.resolve(rawPath.replace(/^~(?=\/)/, process.env.HOME || '~'));
  } catch {
    return fail(res, 400, 'Invalid project path');
  }

  let stats;
  try {
    stats = fs.statSync(projectPath);
  } catch {
    return fail(res, 400, `Directory does not exist: ${projectPath}`);
  }
  if (!stats.isDirectory()) return fail(res, 400, `Not a directory: ${projectPath}`);

  const runner = String(body.runner || '').trim();
  const selected = runner || engine.getState().settings.globalRunner;
  if (!getRunner(selected)) return fail(res, 400, `Unknown runner: ${selected}`);

  const name = String(body.name || '').trim() || path.basename(projectPath);
  try {
    const project = engine.addProject({ name, path: projectPath, runner: selected });
    return res.status(201).json({ ok: true, project });
  } catch (error) {
    return fail(res, 500, error.message);
  }
});

app.delete('/api/projects/:id', (req, res) => {
  const ok = engine.removeProject(req.params.id);
  if (!ok) return fail(res, 404, 'Project not found');
  return res.json({ ok: true });
});

for (const action of ['start', 'pause', 'stop']) {
  app.post(`/api/projects/:id/${action}`, (req, res) => {
    if (!findProject(req.params.id)) return fail(res, 404, 'Project not found');
    engine[action](req.params.id);
    return res.json({ ok: true });
  });
}

app.patch('/api/settings', (req, res) => {
  const body = req.body || {};
  const current = engine.getState().settings;
  const patch = {};

  if (body.maxConcurrent !== undefined) {
    const value = clampNumber(body.maxConcurrent, 0, 10000, current.maxConcurrent);
    patch.maxConcurrent = Math.floor(value);
  }
  if (body.mode !== undefined) {
    if (body.mode !== 'parallel' && body.mode !== 'roundrobin') {
      return fail(res, 400, 'Mode must be parallel or roundrobin');
    }
    patch.mode = body.mode;
  }
  if (body.globalRunner !== undefined) {
    const globalRunner = String(body.globalRunner);
    if (!getRunner(globalRunner)) return fail(res, 400, `Unknown runner: ${globalRunner}`);
    patch.globalRunner = globalRunner;
  }
  if (body.rateLimitPauseSeconds !== undefined) {
    patch.rateLimitPauseSeconds = clampNumber(
      body.rateLimitPauseSeconds,
      5,
      600,
      current.rateLimitPauseSeconds
    );
  }

  try {
    return res.json({ ok: true, settings: engine.updateSettings(patch) });
  } catch (error) {
    return fail(res, 500, error.message);
  }
});

app.get('/api/projects/:id/plan', (req, res) => {
  const plan = engine.getPlan(req.params.id);
  if (!plan) return fail(res, 404, 'Project not found');
  res.set('Cache-Control', 'no-store');
  return res.json(plan);
});

app.put('/api/projects/:id/plan', (req, res) => {
  if (!findProject(req.params.id)) return fail(res, 404, 'Project not found');
  if (typeof req.body?.content !== 'string') return fail(res, 400, 'content must be a string');
  try {
    engine.writePlan(req.params.id, req.body.content);
    return res.json({ ok: true });
  } catch (error) {
    return fail(res, 500, error.message);
  }
});

app.post('/api/projects/:id/tasks', (req, res) => {
  if (!findProject(req.params.id)) return fail(res, 404, 'Project not found');
  const index = Number(req.body?.index);
  if (!Number.isInteger(index) || index < 0) return fail(res, 400, 'index must be a non-negative integer');
  const result = engine.setTaskChecked(req.params.id, index, Boolean(req.body?.checked));
  if (!result.ok) return fail(res, 400, result.error || 'Could not update task');
  return res.json({ ok: true });
});

app.get('/api/projects/:id/icon', (req, res) => {
  const project = findProject(req.params.id);
  if (!project) return fail(res, 404, 'Project not found');
  const icon = engine.getIcon(req.params.id);
  if (!icon) return fail(res, 404, 'No icon found');
  if (!iconLib.isInside(project.path, icon.absolutePath)) return fail(res, 400, 'Invalid icon path');
  res.set('Cache-Control', 'no-cache');
  return res.sendFile(icon.absolutePath, { headers: { 'Content-Type': icon.mime || 'application/octet-stream' } });
});

app.get('/api/runners', (req, res) => {
  res.json({ runners: listRunners() });
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return fail(res, 404, 'Not found');
  return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((error, req, res, next) => {
  console.error('[looparr] request error:', error);
  if (res.headersSent) return next(error);
  return fail(res, 500, error.message || 'Internal server error');
});

engine.init();

const server = app.listen(PORT, HOST, () => {
  console.log(`[looparr] Dashboard running at http://${HOST}:${PORT}`);
});

function shutdown() {
  console.log('[looparr] Shutting down');
  engine.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
