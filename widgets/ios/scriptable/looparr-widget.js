// looparr-widget
// Project card widget for Looparr. Tap to open the dashboard.
// v8 — card order current task → runner · model → up next, rate-limit retry countdown

const BASE_URL = 'https://looparr.tail0307d.ts.net';
const CACHE_PATH = FileManager.local().documentsDirectory() + 'looparr-widget.json';

const STATUS = {
  idle:        { label: 'Idle',         bg: '#1E293B', text: '#CBD5E1', dot: '#94A3B8' },
  seed:        { label: 'Seed',         bg: '#0C2A44', text: '#38BDF8', dot: '#38BDF8' },
  analyze:     { label: 'Analyze',      bg: '#2A1F4A', text: '#A78BFA', dot: '#A78BFA' },
  implement:   { label: 'Implement',    bg: '#12372A', text: '#34D399', dot: '#34D399' },
  paused:      { label: 'Paused',       bg: '#3A2E10', text: '#FCD34D', dot: '#FBBF24' },
  rateLimited: { label: 'Rate Limited', bg: '#3B1D1D', text: '#FCA5A5', dot: '#F87171' },
  done:        { label: 'Done',         bg: '#12372A', text: '#6EE7B7', dot: '#34D399' },
  error:       { label: 'Error',        bg: '#3B1D1D', text: '#FCA5A5', dot: '#F87171' }
};

function readCache() {
  try {
    return JSON.parse(FileManager.local().readString(CACHE_PATH));
  } catch (e) {
    return null;
  }
}

function writeCache(obj) {
  FileManager.local().writeString(CACHE_PATH, JSON.stringify(obj));
}

function findProject(projects, needle) {
  const n = String(needle || '').trim().toLowerCase();
  if (!n) return null;
  return projects.find(p =>
    String(p.id).toLowerCase() === n || String(p.name || '').toLowerCase() === n
  ) || null;
}

function statusInfo(p) {
  if (p.error && String(p.error).indexOf('plan.md:') === 0) {
    return {
      label: 'Setup Needed',
      bg: '#3A2E10',
      text: '#FCD34D',
      dot: '#FBBF24'
    };
  }
  return STATUS[p.status] || {
    label: String(p.status || 'unknown'),
    bg: '#1E293B',
    text: '#CBD5E1',
    dot: '#94A3B8'
  };
}

function iconVersion(project) {
  return String(project.iconVersion || project.icon || '');
}

function projectIconURL(project, suffix) {
  if (!project.id) return null;
  let url = BASE_URL + '/api/projects/' + encodeURIComponent(project.id) + suffix;
  const v = iconVersion(project);
  if (v) url += '?v=' + encodeURIComponent(v);
  return url;
}

async function loadImage(url) {
  if (!url) return null;
  try {
    return await new Request(url).loadImage();
  } catch (e) {
    return null;
  }
}

async function loadIcon(project) {
  // PNG endpoint first. It rasterizes SVG favicons for native clients.
  const pngURL = projectIconURL(project, '/icon.png');
  const rawURL = projectIconURL(project, '/icon');
  const fallbackURL = BASE_URL + '/apple-touch-icon.png';

  return await loadImage(pngURL) ||
         await loadImage(rawURL) ||
         await loadImage(fallbackURL);
}

function initialsFor(project) {
  const words = String(project.name || project.id || '?').split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return (words[0] || '?')[0].toUpperCase();
}

function addIconTile(parent, icon, project) {
  const tile = parent.addStack();
  tile.size = new Size(44, 44);
  tile.cornerRadius = 11;
  tile.backgroundColor = new Color('#0B1220');
  tile.borderWidth = 1;
  tile.borderColor = new Color('#243044');
  tile.setPadding(5, 5, 5, 5);
  tile.centerAlignContent();

  if (icon) {
    const img = tile.addImage(icon);
    img.imageSize = new Size(34, 34);
    return;
  }

  const fallback = tile.addStack();
  fallback.size = new Size(34, 34);
  fallback.cornerRadius = 8;
  const g = new LinearGradient();
  g.colors = [new Color('#2563EB'), new Color('#7C3AED')];
  g.locations = [0, 1];
  g.startPoint = new Point(0, 0);
  g.endPoint = new Point(1, 1);
  fallback.backgroundGradient = g;
  fallback.centerAlignContent();

  const initials = fallback.addText(initialsFor(project));
  initials.font = Font.boldSystemFont(14);
  initials.textColor = Color.white();
}

function addStatusBadge(parent, info) {
  const pill = parent.addStack();
  pill.layoutHorizontally();
  pill.spacing = 5;
  pill.cornerRadius = 10;
  pill.backgroundColor = new Color(info.bg);
  pill.borderWidth = 1;
  pill.borderColor = new Color(info.bg);
  pill.setPadding(3, 8, 3, 8);
  pill.centerAlignContent();

  const dot = pill.addStack();
  dot.size = new Size(6, 6);
  dot.cornerRadius = 3;
  dot.backgroundColor = new Color(info.dot);

  const label = pill.addText(info.label);
  label.font = Font.mediumSystemFont(10);
  label.textColor = new Color(info.text);
  label.lineLimit = 1;
}

// "opencode · omniroute/auto/coding". The engine sets activeRunner/activeModel
// while a step runs; idle cards fall back to the configured runner list and
// effective model, matching the dashboard card.
function runnerModelText(project) {
  const runners = String(project.activeRunner || project.runner || project.effectiveRunners || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const runner = runners.length > 1 ? runners.join(' + ') : (runners[0] || '');
  const model = String(project.activeModel || project.effectiveModel || '').trim();

  if (!runner && !model) return '';
  return (runner || 'runner') + ' · ' + (model || 'default');
}

function addRunnerModel(w, project) {
  const text = runnerModelText(project);
  if (!text) return;

  const row = w.addStack();
  row.layoutHorizontally();
  row.spacing = 5;
  row.centerAlignContent();

  const dot = row.addStack();
  dot.size = new Size(5, 5);
  dot.cornerRadius = 2.5;
  dot.backgroundColor = new Color(project.activeModel ? '#34D399' : '#636366');

  const line = row.addText(text);
  line.font = Font.mediumMonospacedSystemFont(10);
  line.textColor = new Color(project.activeModel ? '#9BD1FF' : '#98989D');
  line.lineLimit = 1;
  line.minimumScaleFactor = 0.65;
}

function progressGradient(pct) {
  const track = new Color('#2C2C2E');
  const g = new LinearGradient();
  g.startPoint = new Point(0, 0.5);
  g.endPoint = new Point(1, 0.5);

  if (pct <= 0) {
    g.colors = [track, track];
    g.locations = [0, 1];
    return g;
  }

  if (pct >= 1) {
    g.colors = [new Color('#0A84FF'), new Color('#5E5CE6'), new Color('#30D158')];
    g.locations = [0, 0.5, 1];
    return g;
  }

  // Simple hard stop. Avoid tiny epsilon stops that can render as no line.
  g.colors = [new Color('#0A84FF'), new Color('#0A84FF'), track, track];
  g.locations = [0, pct, pct, 1];
  return g;
}

function addProgress(w, completed, total) {
  const pct = total > 0 ? Math.max(0, Math.min(1, completed / total)) : 0;

  const row = w.addStack();
  row.layoutHorizontally();
  row.spacing = 6;

  const label = row.addText('Progress');
  label.font = Font.mediumSystemFont(11);
  label.textColor = new Color('#98989D');

  row.addSpacer(null);

  const count = row.addText(completed + ' / ' + total);
  count.font = Font.mediumSystemFont(11);
  count.textColor = new Color('#EDEDED');
  count.lineLimit = 1;

  const bar = w.addStack();
  bar.layoutHorizontally();
  bar.spacing = 0;
  bar.size = new Size(0, 8);
  bar.cornerRadius = 4;
  bar.backgroundColor = new Color('#2C2C2E');
  bar.borderWidth = 1;
  bar.borderColor = new Color('#48484A');
  bar.setPadding(0, 0, 0, 0);
  bar.backgroundGradient = progressGradient(pct);

  // Empty auto-width stacks can collapse. Spacer forces full widget width.
  bar.addSpacer(null);
}

async function renderCard(w, project, offline) {
  w.url = BASE_URL;

  const head = w.addStack();
  head.layoutHorizontally();
  head.spacing = 10;
  head.centerAlignContent();

  const icon = await loadIcon(project);
  addIconTile(head, icon, project);

  const info = head.addStack();
  info.layoutVertically();
  info.spacing = 3;

  const name = info.addText(project.name || project.id || '?');
  name.font = Font.boldSystemFont(15);
  name.textColor = Color.white();
  name.lineLimit = 1;
  name.minimumScaleFactor = 0.75;

  const path = info.addText(project.path || '');
  path.font = Font.systemFont(10);
  path.textColor = new Color('#98989D');
  path.lineLimit = 1;
  path.minimumScaleFactor = 0.8;

  head.addSpacer(null);

  const statusCol = head.addStack();
  statusCol.layoutVertically();
  statusCol.spacing = 3;
  addStatusBadge(statusCol, statusInfo(project));

  if (project.status === 'rateLimited' && project.resumeAt) {
    const wait = Math.max(0, Math.ceil((project.resumeAt - Date.now()) / 1000));
    const retry = statusCol.addText('Retry ' + wait + 's');
    retry.font = Font.mediumSystemFont(9);
    retry.textColor = new Color('#FF9F0A');
    retry.lineLimit = 1;
  }

  if (offline) {
    const off = statusCol.addText('Offline');
    off.font = Font.mediumSystemFont(9);
    off.textColor = new Color('#FF9F0A');
    off.lineLimit = 1;
  }

  const task = w.addText(project.currentTask || 'No current task');
  task.font = Font.systemFont(12);
  task.textColor = Color.white();
  task.lineLimit = 2;

  addRunnerModel(w, project);

  if (project.nextTask) {
    const next = w.addText('Up next: ' + project.nextTask);
    next.font = Font.systemFont(10);
    next.textColor = new Color('#98989D');
    next.lineLimit = 1;
  }

  if (project.error && String(project.error).indexOf('plan.md:') !== 0) {
    const err = w.addText(String(project.error).split('\n')[0]);
    err.font = Font.systemFont(10);
    err.textColor = new Color('#FF453A');
    err.lineLimit = 1;
  }

  const total = project.progress ? project.progress.total : 0;
  const completed = project.progress ? project.progress.completed : 0;
  addProgress(w, completed, total);
}

function renderChoose(w, param, projects, cache) {
  w.url = 'scriptable:///run?scriptName=looparr-picker';

  const title = w.addText('Looparr');
  title.font = Font.boldSystemFont(20);
  title.textColor = Color.white();

  const sub = w.addText('Tap to choose a project');
  sub.font = Font.mediumSystemFont(12);
  sub.textColor = new Color('#98989D');

  if (!projects.length) {
    const err = w.addText('Server unreachable or no projects');
    err.font = Font.systemFont(10);
    err.textColor = new Color('#FF453A');
  }

  const debug = w.addText('param=' + (param || '-') + ' cacheId=' + (cache && cache.projectId || '-') + ' projects=' + (projects ? projects.length : 0));
  debug.font = Font.systemFont(8);
  debug.textColor = new Color('#FF9F0A');
  debug.lineLimit = 1;
}

async function run() {
  const w = new ListWidget();
  w.backgroundColor = new Color('#111114');
  w.spacing = 8;
  w.setPadding(14, 14, 14, 14);

  const param = String(args.widgetParameter || '').trim();
  const cache = readCache();

  let projects = [];
  let offline = false;
  let freshData = null;

  try {
    freshData = await new Request(BASE_URL + '/api/state').loadJSON();
    projects = (freshData && freshData.projects) || [];
  } catch (e) {
    offline = true;
    projects = (cache && cache.data && cache.data.projects) || [];
  }

  if (freshData) {
    try {
      writeCache({
        projectId: (cache && cache.projectId) || null,
        savedAt: Date.now(),
        data: freshData
      });
    } catch (e) {}
  }

  let project = param ? findProject(projects, param) : null;
  if (!project && cache && cache.projectId) {
    project = findProject(projects, cache.projectId);
  }

  if (project) {
    await renderCard(w, project, offline);
  } else {
    renderChoose(w, param, projects, cache);
  }

  if (config.runsInWidget) {
    Script.setWidget(w);
  } else {
    Safari.open('scriptable:///run?scriptName=looparr-picker');
  }
  Script.complete();
}

await run();
