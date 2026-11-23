// looparr-meta-widget
// Thin Scriptable client. The card, its wording and its colors come from
// <BASE_URL>/api/widget, so dashboard changes reach this widget without
// re-copying the script. Widget parameter: project id, name or path; empty
// follows the running project (then a rate-limited one, then the first).
// v1

const BASE_URL = 'https://looparr.tail0307d.ts.net';
// Earliest refresh the script asks for. iOS decides the real schedule and
// budgets roughly 40-70 refreshes a day, so a lower value is not a guarantee.
const REFRESH_AFTER_MINUTES = 5;
const fm = FileManager.local();
const CACHE_PATH = fm.joinPath(fm.documentsDirectory(), 'looparr-meta-widget.json');

// The cache only exists after the first successful fetch. Scriptable throws on
// readString for a missing path, so guard with fileExists instead of relying on
// the catch alone.
function readCache() {
  try {
    if (!fm.fileExists(CACHE_PATH)) return null;
    return JSON.parse(fm.readString(CACHE_PATH));
  } catch (e) {
    return null;
  }
}

function writeCache(payload) {
  try {
    fm.writeString(CACHE_PATH, JSON.stringify(payload));
  } catch (e) {}
}

function initials(name) {
  const words = String(name || '?').split(/\s+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] || '?')[0].toUpperCase();
}

function iconURL(card) {
  if (!card.iconPath) return BASE_URL + '/apple-touch-icon.png';
  const version = card.iconVersion ? '?v=' + encodeURIComponent(card.iconVersion) : '';
  return BASE_URL + card.iconPath + version;
}

async function loadImage(url) {
  try {
    return await new Request(url).loadImage();
  } catch (e) {
    return null;
  }
}

function addIconTile(parent, image, card) {
  const tile = parent.addStack();
  tile.size = new Size(44, 44);
  tile.cornerRadius = 11;
  tile.backgroundColor = new Color('#0B1220');
  tile.borderWidth = 1;
  tile.borderColor = new Color('#243044');
  tile.setPadding(5, 5, 5, 5);
  tile.centerAlignContent();

  if (image) {
    const img = tile.addImage(image);
    img.imageSize = new Size(34, 34);
    return;
  }

  const fallback = tile.addStack();
  fallback.size = new Size(34, 34);
  fallback.cornerRadius = 8;
  const gradient = new LinearGradient();
  gradient.colors = [new Color('#2563EB'), new Color('#7C3AED')];
  gradient.locations = [0, 1];
  gradient.startPoint = new Point(0, 0);
  gradient.endPoint = new Point(1, 1);
  fallback.backgroundGradient = gradient;
  fallback.centerAlignContent();

  const label = fallback.addText(initials(card.name));
  label.font = Font.boldSystemFont(14);
  label.textColor = Color.white();
}

function addBadge(parent, badge) {
  const pill = parent.addStack();
  pill.layoutHorizontally();
  pill.spacing = 5;
  pill.cornerRadius = 10;
  pill.backgroundColor = new Color(badge.bg);
  pill.borderWidth = 1;
  pill.borderColor = new Color(badge.bg);
  pill.setPadding(3, 8, 3, 8);
  pill.centerAlignContent();

  const dot = pill.addStack();
  dot.size = new Size(6, 6);
  dot.cornerRadius = 3;
  dot.backgroundColor = new Color(badge.dot);

  const label = pill.addText(badge.label);
  label.font = Font.mediumSystemFont(10);
  label.textColor = new Color(badge.text);
  label.lineLimit = 1;
}

function progressGradient(pct) {
  const track = new Color('#2C2C2E');
  const gradient = new LinearGradient();
  gradient.startPoint = new Point(0, 0.5);
  gradient.endPoint = new Point(1, 0.5);

  if (pct <= 0) {
    gradient.colors = [track, track];
    gradient.locations = [0, 1];
  } else if (pct >= 1) {
    gradient.colors = [new Color('#0A84FF'), new Color('#5E5CE6'), new Color('#30D158')];
    gradient.locations = [0, 0.5, 1];
  } else {
    gradient.colors = [new Color('#0A84FF'), new Color('#0A84FF'), track, track];
    gradient.locations = [0, pct, pct, 1];
  }
  return gradient;
}

function addProgress(w, progress) {
  const total = Number(progress && progress.total) || 0;
  const completed = Number(progress && progress.completed) || 0;
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
  bar.addSpacer(null);
}

async function renderCard(w, card, offline) {
  w.url = BASE_URL + (card.href || '/');

  const head = w.addStack();
  head.layoutHorizontally();
  head.spacing = 10;
  head.centerAlignContent();

  addIconTile(head, await loadImage(iconURL(card)), card);

  const info = head.addStack();
  info.layoutVertically();
  info.spacing = 3;

  const name = info.addText(card.name);
  name.font = Font.boldSystemFont(15);
  name.textColor = Color.white();
  name.lineLimit = 1;
  name.minimumScaleFactor = 0.75;

  const path = info.addText(card.path);
  path.font = Font.systemFont(10);
  path.textColor = new Color('#98989D');
  path.lineLimit = 1;
  path.minimumScaleFactor = 0.8;

  head.addSpacer(null);

  const statusCol = head.addStack();
  statusCol.layoutVertically();
  statusCol.spacing = 3;
  addBadge(statusCol, card.badge);

  if (card.retryInSeconds > 0) {
    const retry = statusCol.addText('Retry ' + card.retryInSeconds + 's');
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

  const task = w.addText(card.currentTask || 'No current task');
  task.font = Font.systemFont(12);
  task.textColor = Color.white();
  task.lineLimit = 2;

  if (card.runner && card.runner.text) {
    const row = w.addStack();
    row.layoutHorizontally();
    row.spacing = 5;
    row.centerAlignContent();

    const dot = row.addStack();
    dot.size = new Size(5, 5);
    dot.cornerRadius = 2.5;
    dot.backgroundColor = new Color(card.runner.active ? '#34D399' : '#636366');

    const line = row.addText(card.runner.text);
    line.font = Font.mediumMonospacedSystemFont(10);
    line.textColor = new Color(card.runner.active ? '#9BD1FF' : '#98989D');
    line.lineLimit = 1;
    line.minimumScaleFactor = 0.65;
  }

  if (card.nextTask) {
    const next = w.addText('Up next: ' + card.nextTask);
    next.font = Font.systemFont(10);
    next.textColor = new Color('#98989D');
    next.lineLimit = 1;
  }

  if (card.error) {
    const err = w.addText(String(card.error).split('\n')[0]);
    err.font = Font.systemFont(10);
    err.textColor = new Color('#FF453A');
    err.lineLimit = 1;
  }

  addProgress(w, card.progress);
}

function renderChoose(w, payload, offline) {
  w.url = BASE_URL;

  const title = w.addText('Looparr');
  title.font = Font.boldSystemFont(20);
  title.textColor = Color.white();

  const sub = w.addText('Tap to open the dashboard');
  sub.font = Font.mediumSystemFont(12);
  sub.textColor = new Color('#98989D');

  const projects = (payload && payload.projects) || [];
  if (projects.length) {
    const names = projects.slice(0, 3).map((project) => project.name).join(', ');
    const hint = w.addText('Set the widget parameter to a project: ' + names);
    hint.font = Font.systemFont(10);
    hint.textColor = new Color('#98989D');
    hint.lineLimit = 2;
  } else {
    const err = w.addText(offline ? 'Server unreachable and no cached card' : 'No projects yet');
    err.font = Font.systemFont(10);
    err.textColor = new Color('#FF453A');
  }
}

async function run() {
  const w = new ListWidget();
  w.refreshAfterDate = new Date(Date.now() + REFRESH_AFTER_MINUTES * 60 * 1000);
  w.backgroundColor = new Color('#111114');
  w.spacing = 8;
  w.setPadding(14, 14, 14, 14);

  const param = String(args.widgetParameter || '').trim();
  const cache = readCache();
  const url = BASE_URL + '/api/widget' + (param ? '?project=' + encodeURIComponent(param) : '');

  let payload = null;
  let offline = false;

  try {
    payload = await new Request(url).loadJSON();
  } catch (e) {
    offline = true;
    payload = cache;
  }

  if (payload && payload.ok && !offline) {
    writeCache(payload);
  } else if (!payload) {
    payload = cache;
    offline = true;
  }

  if (payload && payload.project) {
    await renderCard(w, payload.project, offline);
  } else {
    renderChoose(w, payload, offline);
  }

  if (config.runsInWidget) {
    Script.setWidget(w);
  } else {
    Safari.open(BASE_URL);
  }
  Script.complete();
}

await run();
