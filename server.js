'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

const engine = require('./src/engine');
const bus = require('./src/events');
const envSettings = require('./src/env-settings');
const iconLib = require('./src/icon');
const iconPngLib = require('./src/icon-png');
const { getRunner, listRunners } = require('./src/runners');
const { parseModelList } = require('./src/model-list');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

const PROJECTS_ROOT = path.resolve(process.env.LOOPARR_PROJECTS_ROOT || '/home/michaelpeele/ai-projects');
const PLAN_FILE_MAX_BYTES = 200000;
const PLAN_FILE_BASENAME = /^(PLAN|plan)-[^/\\]+\.md$/;
const PLAN_FILE_DIR_PREFIX = '.project_documents/';

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function rootRealPath() {
  try { return fs.realpathSync(PROJECTS_ROOT); } catch { return PROJECTS_ROOT; }
}

function normalizeRelativeDir(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: '' };
  if (typeof value !== 'string') return { ok: false, error: 'Directory must be a string' };
  if (value.includes('\0') || value.includes('\\')) return { ok: false, error: 'Invalid directory' };
  if (path.isAbsolute(value) || value.startsWith('/')) return { ok: false, error: 'Directory must be relative to the projects root' };
  const normalized = path.posix.normalize(value).replace(/\/+$/, '');
  return { ok: true, value: normalized === '.' ? '' : normalized };
}

function toRootRelative(rootReal, target) {
  if (!isInside(rootReal, target)) return null;
  return path.relative(rootReal, target).split(path.sep).join('/');
}

function resolveInsideRootDirectory(value, options = {}) {
  const { rejectSymlink = false } = options;
  const normalized = normalizeRelativeDir(value);
  if (!normalized.ok) return { ok: false, status: 400, error: normalized.error };

  const rootReal = rootRealPath();
  const candidate = path.resolve(rootReal, normalized.value || '.');
  if (!isInside(rootReal, candidate)) {
    return { ok: false, status: 400, error: 'Directory outside the projects root', rootReal };
  }

  let real;
  try {
    real = fs.realpathSync(candidate);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return { ok: false, status: 404, error: 'Directory not found', rootReal, candidate };
    }
    return { ok: false, status: 400, error: 'Invalid directory', rootReal, candidate };
  }
  if (!isInside(rootReal, real)) {
    return { ok: false, status: 400, error: 'Directory outside the projects root', rootReal, candidate };
  }
  if (rejectSymlink && real !== candidate) {
    return { ok: false, status: 400, error: 'Directory outside the projects root', rootReal, candidate };
  }

  let stats;
  try {
    stats = fs.statSync(real);
  } catch {
    return { ok: false, status: 404, error: 'Directory not found', rootReal, candidate };
  }
  if (!stats.isDirectory()) {
    return { ok: false, status: 400, error: 'Not a directory', rootReal, candidate, real };
  }

  const relative = toRootRelative(rootReal, real);
  if (relative === null) {
    return { ok: false, status: 400, error: 'Directory outside the projects root', rootReal, candidate };
  }
  return { ok: true, rootReal, candidate, real, relative };
}

function validateFolderName(value) {
  if (typeof value !== 'string') return { ok: false, error: 'Folder name must be a string' };
  const name = value.trim();
  if (!name) return { ok: false, error: 'Folder name is required' };
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) {
    return { ok: false, error: 'Invalid folder name' };
  }
  return { ok: true, value: name };
}

function cleanupCreatedFolder(target, rootReal) {
  if (!isInside(rootReal, target)) return;
  try { fs.rmdirSync(target); } catch { /* best effort cleanup */ }
}

app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));

function fail(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
}

function findProject(id) {
  return engine.getState().projects.find((project) => project.id === id) || null;
}

function resolveProjectIcon(id) {
  const project = findProject(id);
  if (!project) return { ok: false, status: 404, error: 'Project not found' };
  const icon = engine.getIcon(id);
  if (!icon) return { ok: false, status: 404, error: 'No icon found' };
  if (!iconLib.isInside(project.path, icon.absolutePath)) {
    return { ok: false, status: 400, error: 'Invalid icon path' };
  }

  let projectReal;
  let iconReal;
  try {
    projectReal = fs.realpathSync(project.path);
    iconReal = fs.realpathSync(icon.absolutePath);
  } catch {
    return { ok: false, status: 404, error: 'Icon unavailable' };
  }
  if (!iconLib.isInside(projectReal, iconReal)) {
    return { ok: false, status: 400, error: 'Invalid icon path' };
  }

  return {
    ok: true,
    project,
    icon: { ...icon, absolutePath: iconReal, realPath: iconReal }
  };
}

function resolveProjectPlanFile(project, requestedPath) {
  if (typeof requestedPath !== 'string') return { ok: false, status: 400, error: 'path must be a string' };
  if (!requestedPath || requestedPath.includes('\0') || requestedPath.includes('\\') ||
      path.isAbsolute(requestedPath) || requestedPath.startsWith('/')) {
    return { ok: false, status: 400, error: 'Invalid plan file path' };
  }
  if (requestedPath.split('/').includes('..')) {
    return { ok: false, status: 400, error: 'Invalid plan file path' };
  }

  let rest = requestedPath;
  if (rest.startsWith('./')) rest = rest.slice(2);
  let relativeDir = '';
  if (rest.startsWith(PLAN_FILE_DIR_PREFIX)) {
    relativeDir = '.project_documents';
    rest = rest.slice(PLAN_FILE_DIR_PREFIX.length);
  }
  if (rest.startsWith('./')) rest = rest.slice(2);
  if (!rest || rest.includes('/') || !PLAN_FILE_BASENAME.test(rest)) {
    return { ok: false, status: 400, error: 'Invalid plan file path' };
  }

  let projectReal;
  try {
    projectReal = fs.realpathSync(project.path);
  } catch {
    return { ok: false, status: 404, error: 'Project directory not found' };
  }

  const candidateParent = path.resolve(projectReal, relativeDir || '.');
  if (!isInside(projectReal, candidateParent)) {
    return { ok: false, status: 400, error: 'Invalid plan file path' };
  }
  return {
    ok: true,
    projectReal,
    relativeDir,
    basename: rest,
    candidateParent,
    candidate: path.join(candidateParent, rest)
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function parseBlockThreshold(value, fallback, label) {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === '') return { ok: true, value: fallback };
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 20) {
    return { ok: false, error: `${label} must be an integer between 1 and 20` };
  }
  return { ok: true, value: number };
}

function parseCooloffSeconds(value, fallback, label) {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === '') return { ok: true, value: fallback };
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 3600) {
    return { ok: false, error: `${label} must be an integer between 0 and 3600` };
  }
  return { ok: true, value: number };
}

function parseLiftScope(value, fallback, label) {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: fallback };
  if (typeof value !== 'string') return { ok: false, error: `${label} must be a string` };
  const scope = value.trim();
  if (scope.length > 2000) return { ok: false, error: `${label} must be at most 2000 characters` };
  return { ok: true, value: scope };
}

function parseModel(value, fallback, label) {
  return parseModelList(value, fallback, label);
}

const MODEL_PHASE_FIELDS = [
  { field: 'seedModel', label: 'Seed model' },
  { field: 'analyzeModel', label: 'Analyze model' },
  { field: 'implementModel', label: 'Implement model' }
];

function applyModelPhaseFields(body, target) {
  for (const { field, label } of MODEL_PHASE_FIELDS) {
    const parsed = parseModel(body[field], '', label);
    if (!parsed.ok) return parsed;
    if (parsed.value !== undefined) target[field] = parsed.value;
  }
  return { ok: true };
}

const MODEL_ROTATION_FIELDS = [
  { field: 'modelRotation', label: 'Model rotation' },
  { field: 'seedRotation', label: 'Seed rotation' },
  { field: 'analyzeRotation', label: 'Analyze rotation' },
  { field: 'implementRotation', label: 'Implement rotation' }
];

function applyRotationFields(body, target, allowNull = false) {
  for (const { field, label } of MODEL_ROTATION_FIELDS) {
    if (body[field] === undefined) continue;
    if (body[field] === null) {
      if (!allowNull) return { ok: false, error: `${label} must be a boolean` };
      target[field] = null;
      continue;
    }
    if (typeof body[field] !== 'boolean') {
      return { ok: false, error: `${label} must be a boolean` };
    }
    target[field] = body[field];
  }
  return { ok: true };
}

const PROMPT_TEMPLATE_FIELDS = [
  { field: 'seedPromptTemplate', label: 'Seed prompt template', placeholders: ['{{task}}'] },
  { field: 'analyzePromptTemplate', label: 'Analyze prompt template', placeholders: ['{{task}}', '{{handoff}}'] },
  { field: 'implementPromptTemplate', label: 'Implement prompt template', placeholders: ['{{task}}', '{{handoff}}'] }
];

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

  const model = parseModel(body.model, '', 'Model');
  if (!model.ok) return fail(res, 400, model.error);
  const modelFields = { model: model.value };
  const phaseModels = applyModelPhaseFields(body, modelFields);
  if (!phaseModels.ok) return fail(res, 400, phaseModels.error);
  const rotations = applyRotationFields(body, modelFields, true);
  if (!rotations.ok) return fail(res, 400, rotations.error);

  const threshold = parseBlockThreshold(body.blockThreshold, null, 'Block threshold');
  if (!threshold.ok) return fail(res, 400, threshold.error);
  const cooloff = parseCooloffSeconds(body.cooloffSeconds, null, 'Cooloff');
  if (!cooloff.ok) return fail(res, 400, cooloff.error);
  const temporaryLift = parseLiftScope(body.temporaryLiftScope, '', 'Temporary lift scope');
  if (!temporaryLift.ok) return fail(res, 400, temporaryLift.error);
  const permanentLift = parseLiftScope(body.permanentLift, '', 'Permanent lift');
  if (!permanentLift.ok) return fail(res, 400, permanentLift.error);

  if (body.autoResumeOnStart !== undefined && typeof body.autoResumeOnStart !== 'boolean') {
    return fail(res, 400, 'autoResumeOnStart must be a boolean');
  }

  const name = String(body.name || '').trim() || path.basename(projectPath);
  try {
    const project = engine.addProject({
      name,
      path: projectPath,
      runner: selected,
      ...modelFields,
      blockThreshold: threshold.value,
      cooloffSeconds: cooloff.value,
      temporaryLiftScope: temporaryLift.value,
      permanentLift: permanentLift.value,
      autoResumeOnStart: body.autoResumeOnStart
    });
    return res.status(201).json({ ok: true, project });
  } catch (error) {
    return fail(res, 500, error.message);
  }
});

app.get('/api/folders', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const dir = resolveInsideRootDirectory(req.query?.dir, { rejectSymlink: true });
  if (!dir.ok) return fail(res, dir.status, dir.error);

  let entries;
  try {
    entries = fs.readdirSync(dir.real, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return fail(res, 404, 'Directory not found');
    return fail(res, 400, 'Unable to read directory');
  }

  const folders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const folderPath = path.join(dir.real, entry.name);
      return { name: entry.name, path: folderPath, relative: toRootRelative(dir.rootReal, folderPath) };
    })
    .sort((a, b) => {
      const natural = a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
      if (natural) return natural;
      return a.name.localeCompare(b.name) || a.relative.localeCompare(b.relative);
    });

  const relative = dir.relative;
  const parent = relative === '' ? null : (relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '');
  return res.json({ ok: true, root: dir.rootReal, current: dir.real, relative, parent, folders });
});

app.post('/api/folders', (req, res) => {
  const body = req.body || {};
  const name = validateFolderName(body.name);
  if (!name.ok) return fail(res, 400, name.error);

  const dir = resolveInsideRootDirectory(body.dir, { rejectSymlink: true });
  if (!dir.ok) return fail(res, dir.status, dir.error);

  const target = path.join(dir.real, name.value);
  if (!isInside(dir.rootReal, target)) return fail(res, 400, 'Folder outside the projects root');

  let existing;
  try {
    existing = fs.lstatSync(target);
  } catch (error) {
    if (error.code !== 'ENOENT') return fail(res, 400, 'Unable to inspect folder path');
  }
  if (existing) return fail(res, 409, 'Folder already exists');

  try {
    fs.mkdirSync(target);
  } catch (error) {
    if (error.code === 'EEXIST') return fail(res, 409, 'Folder already exists');
    return fail(res, 400, 'Unable to create folder');
  }

  let createdReal;
  try {
    createdReal = fs.realpathSync(target);
  } catch {
    cleanupCreatedFolder(target, dir.rootReal);
    return fail(res, 400, 'Unable to create folder');
  }
  if (!isInside(dir.rootReal, createdReal)) {
    cleanupCreatedFolder(target, dir.rootReal);
    return fail(res, 400, 'Folder outside the projects root');
  }
  const createdRelative = toRootRelative(dir.rootReal, createdReal);
  if (createdRelative === null) {
    cleanupCreatedFolder(target, dir.rootReal);
    return fail(res, 400, 'Folder outside the projects root');
  }

  return res.status(201).json({
    ok: true,
    folder: {
      name: name.value,
      path: createdReal,
      relative: createdRelative,
      parent: dir.relative
    }
  });
});

app.patch('/api/projects/:id', (req, res) => {
  const body = req.body || {};
  const patch = {};
  const model = parseModel(body.model, '', 'Model');
  if (!model.ok) return fail(res, 400, model.error);
  if (model.value !== undefined) patch.model = model.value;
  const phaseModels = applyModelPhaseFields(body, patch);
  if (!phaseModels.ok) return fail(res, 400, phaseModels.error);
  const rotations = applyRotationFields(body, patch, true);
  if (!rotations.ok) return fail(res, 400, rotations.error);
  if (body.runner !== undefined) {
    const runner = String(body.runner).trim();
    if (!getRunner(runner)) return fail(res, 400, `Unknown runner: ${runner}`);
    patch.runner = runner;
  }
  if (body.autoResumeOnStart !== undefined) {
    if (typeof body.autoResumeOnStart !== 'boolean') {
      return fail(res, 400, 'autoResumeOnStart must be a boolean');
    }
    patch.autoResumeOnStart = body.autoResumeOnStart;
  }
  const threshold = parseBlockThreshold(body.blockThreshold, null, 'Block threshold');
  if (!threshold.ok) return fail(res, 400, threshold.error);
  if (threshold.value !== undefined) patch.blockThreshold = threshold.value;
  const cooloff = parseCooloffSeconds(body.cooloffSeconds, null, 'Cooloff');
  if (!cooloff.ok) return fail(res, 400, cooloff.error);
  if (cooloff.value !== undefined) patch.cooloffSeconds = cooloff.value;
  const temporaryLift = parseLiftScope(body.temporaryLiftScope, '', 'Temporary lift scope');
  if (!temporaryLift.ok) return fail(res, 400, temporaryLift.error);
  if (temporaryLift.value !== undefined) patch.temporaryLiftScope = temporaryLift.value;
  const permanentLift = parseLiftScope(body.permanentLift, '', 'Permanent lift');
  if (!permanentLift.ok) return fail(res, 400, permanentLift.error);
  if (permanentLift.value !== undefined) patch.permanentLift = permanentLift.value;
  if (!Object.keys(patch).length) return fail(res, 400, 'No project fields to update');
  try {
    const project = engine.updateProject(req.params.id, patch);
    if (!project) return fail(res, 404, 'Project not found');
    return res.json({ ok: true, project });
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
  const model = parseModel(body.model, '', 'Model');
  if (!model.ok) return fail(res, 400, model.error);
  if (model.value !== undefined) patch.model = model.value;
  const phaseModels = applyModelPhaseFields(body, patch);
  if (!phaseModels.ok) return fail(res, 400, phaseModels.error);
  const rotations = applyRotationFields(body, patch);
  if (!rotations.ok) return fail(res, 400, rotations.error);
  if (body.rateLimitPauseSeconds !== undefined) {
    patch.rateLimitPauseSeconds = clampNumber(
      body.rateLimitPauseSeconds,
      5,
      600,
      current.rateLimitPauseSeconds
    );
  }
  if (body.cooloffSeconds !== undefined) {
    patch.cooloffSeconds = clampNumber(body.cooloffSeconds, 0, 3600, current.cooloffSeconds);
  }
  const threshold = parseBlockThreshold(body.blockThreshold, current.blockThreshold, 'Block threshold');
  if (!threshold.ok) return fail(res, 400, threshold.error);
  if (threshold.value !== undefined) patch.blockThreshold = threshold.value;
  const temporaryLift = parseLiftScope(
    body.temporaryLiftScope,
    current.temporaryLiftScope,
    'Temporary lift scope'
  );
  if (!temporaryLift.ok) return fail(res, 400, temporaryLift.error);
  if (temporaryLift.value !== undefined) patch.temporaryLiftScope = temporaryLift.value;
  const permanentLift = parseLiftScope(body.permanentLift, current.permanentLift, 'Permanent lift');
  if (!permanentLift.ok) return fail(res, 400, permanentLift.error);
  if (permanentLift.value !== undefined) patch.permanentLift = permanentLift.value;
  if (body.promptCliToolsNote !== undefined) {
    if (typeof body.promptCliToolsNote !== 'boolean') {
      return fail(res, 400, 'promptCliToolsNote must be a boolean');
    }
    patch.promptCliToolsNote = body.promptCliToolsNote;
  }
  if (body.stickyAddTaskRow !== undefined) {
    if (typeof body.stickyAddTaskRow !== 'boolean') {
      return fail(res, 400, 'stickyAddTaskRow must be a boolean');
    }
    patch.stickyAddTaskRow = body.stickyAddTaskRow;
  }
  for (const { field, label, placeholders } of PROMPT_TEMPLATE_FIELDS) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== 'string') return fail(res, 400, `${label} must be a string`);
    const template = body[field];
    if (!template.trim()) return fail(res, 400, `${label} cannot be empty`);
    if (template.length > 20000) return fail(res, 400, `${label} must be at most 20000 characters`);
    for (const placeholder of placeholders) {
      if (!template.includes(placeholder)) return fail(res, 400, `${label} must include ${placeholder}`);
    }
    patch[field] = template;
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
    engine.writePlan(req.params.id, req.body.content, req.body.change);
    return res.json({ ok: true });
  } catch (error) {
    return fail(res, 500, error.message);
  }
});

app.get('/api/projects/:id/plan-file', (req, res) => {
  const project = findProject(req.params.id);
  if (!project) return fail(res, 404, 'Project not found');
  const target = resolveProjectPlanFile(project, req.query.path);
  if (!target.ok) return fail(res, target.status, target.error);

  let realFile;
  try {
    realFile = fs.realpathSync(target.candidate);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return fail(res, 404, 'Plan file not found');
    return fail(res, 400, 'Invalid plan file path');
  }
  if (!isInside(target.projectReal, realFile)) return fail(res, 400, 'Invalid plan file path');

  let stats;
  try {
    stats = fs.statSync(realFile);
  } catch {
    return fail(res, 404, 'Plan file not found');
  }
  if (!stats.isFile()) return fail(res, 400, 'Not a file');
  if (stats.size > PLAN_FILE_MAX_BYTES) return fail(res, 413, 'Plan file too large');

  try {
    const content = fs.readFileSync(realFile, 'utf8');
    if (Buffer.byteLength(content, 'utf8') > PLAN_FILE_MAX_BYTES) return fail(res, 413, 'Plan file too large');
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, content });
  } catch (error) {
    return fail(res, 500, error.message);
  }
});

app.put('/api/projects/:id/plan-file', (req, res) => {
  const project = findProject(req.params.id);
  if (!project) return fail(res, 404, 'Project not found');
  if (typeof req.body?.content !== 'string') return fail(res, 400, 'content must be a string');
  if (Buffer.byteLength(req.body.content, 'utf8') > PLAN_FILE_MAX_BYTES) {
    return fail(res, 413, 'content must be at most 200000 bytes');
  }
  const target = resolveProjectPlanFile(project, req.query.path);
  if (!target.ok) return fail(res, target.status, target.error);

  let realParent;
  try {
    realParent = fs.realpathSync(target.candidateParent);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return fail(res, 404, 'Plan file directory not found');
    return fail(res, 400, 'Invalid plan file path');
  }
  if (!isInside(target.projectReal, realParent)) return fail(res, 400, 'Invalid plan file path');

  let parentStats;
  try {
    parentStats = fs.statSync(realParent);
  } catch {
    return fail(res, 404, 'Plan file directory not found');
  }
  if (!parentStats.isDirectory()) return fail(res, 400, 'Not a directory');

  const file = path.join(realParent, target.basename);
  let currentStats = null;
  try {
    currentStats = fs.lstatSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') return fail(res, 400, 'Invalid plan file path');
  }
  if (currentStats?.isSymbolicLink()) {
    let linkedFile;
    try {
      linkedFile = fs.realpathSync(file);
    } catch {
      return fail(res, 400, 'Invalid plan file path');
    }
    if (!isInside(target.projectReal, linkedFile)) return fail(res, 400, 'Invalid plan file path');
    try {
      if (!fs.statSync(linkedFile).isFile()) return fail(res, 400, 'Not a file');
    } catch {
      return fail(res, 400, 'Invalid plan file path');
    }
  } else if (currentStats && !currentStats.isFile()) {
    return fail(res, 400, 'Not a file');
  }

  const temp = path.join(realParent, `.${target.basename}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temp, req.body.content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, file);
    return res.json({ ok: true });
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* best effort cleanup */ }
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

app.get('/api/projects/:id/answer', (req, res) => {
  const answer = engine.getAnswer(req.params.id);
  if (!answer) return fail(res, 404, 'Project not found');
  if (!answer.ok) return fail(res, 500, answer.error || 'Could not read answer');
  res.set('Cache-Control', 'no-store');
  return res.json(answer);
});

app.put('/api/projects/:id/answer', (req, res) => {
  if (!findProject(req.params.id)) return fail(res, 404, 'Project not found');
  if (typeof req.body?.content !== 'string') return fail(res, 400, 'content must be a string');
  const answer = engine.writeAnswer(req.params.id, req.body.content);
  if (!answer.ok) return fail(res, 400, answer.error || 'Could not save answer');
  return res.json(answer);
});

app.get('/api/projects/:id/icon', (req, res) => {
  const resolved = resolveProjectIcon(req.params.id);
  if (!resolved.ok) return fail(res, resolved.status, resolved.error);

  const icon = resolved.icon;
  const contentType = icon.mime || 'application/octet-stream';
  const headers = { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' };
  if (contentType === 'image/svg+xml') {
    headers['Content-Security-Policy'] = "default-src 'none'; sandbox";
  }
  if (icon.version) headers.ETag = `"${icon.version}"`;
  res.set('Cache-Control', 'no-cache');
  res.set(headers);
  return res.sendFile(icon.absolutePath, { headers }, (error) => {
    if (!error) return;
    if (!res.headersSent) return fail(res, 404, 'Icon unavailable');
    if (!res.writableEnded) res.end();
  });
});

app.get('/api/projects/:id/icon.png', async (req, res) => {
  const resolved = resolveProjectIcon(req.params.id);
  if (!resolved.ok) return fail(res, resolved.status, resolved.error);

  let rendered;
  try {
    rendered = await iconPngLib.renderPng(resolved.icon);
  } catch {
    rendered = null;
  }
  if (!rendered) return fail(res, 404, 'Icon unavailable');

  const etag = `"${rendered.etag}"`;
  res.set({
    'Content-Type': 'image/png',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
    ETag: etag
  });
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  return res.status(200).send(rendered.buffer);
});

app.get('/api/runners', (req, res) => {
  res.json({ runners: listRunners() });
});

app.get('/api/env-settings', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true, entries: envSettings.list() });
});

app.post('/api/env-settings/reveal', (req, res) => {
  const result = envSettings.reveal(req.body?.key);
  if (!result.ok) return fail(res, 400, result.error || 'Could not reveal value');
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true, key: req.body.key, value: result.value });
});

app.patch('/api/env-settings', (req, res) => {
  const result = envSettings.update(req.body?.updates);
  if (!result.ok) return fail(res, 400, result.error || 'Could not update .env');
  return res.json({ ok: true, updated: result.updated, entries: result.entries });
});

app.post('/api/auto-resume/prepare', async (req, res, next) => {
  const reason = req.body?.reason === undefined ? 'planned-restart' : req.body.reason;
  if (reason !== 'planned-restart' && reason !== 'container-shutdown') {
    return fail(res, 400, 'Unknown auto-resume reason');
  }
  try {
    const result = await engine.prepareShutdownResume(reason);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return next(error);
  }
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

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[looparr] Shutting down');
  try {
    await engine.prepareShutdownResume('container-shutdown');
  } catch (error) {
    console.error('[looparr] prepare shutdown resume failed:', error.message);
  }
  engine.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
