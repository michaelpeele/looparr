'use strict';

// Card presentation for native clients (the iOS Scriptable widget).
// Building the card here means a layout or wording change on the dashboard
// reaches already-installed widgets without re-copying script code to a phone.

const STATUS_STYLES = {
  idle:        { label: 'Idle',         bg: '#1E293B', text: '#CBD5E1', dot: '#94A3B8' },
  seed:        { label: 'Seed',         bg: '#0C2A44', text: '#38BDF8', dot: '#38BDF8' },
  analyze:     { label: 'Analyze',      bg: '#2A1F4A', text: '#A78BFA', dot: '#A78BFA' },
  implement:   { label: 'Implement',    bg: '#12372A', text: '#34D399', dot: '#34D399' },
  paused:      { label: 'Paused',       bg: '#3A2E10', text: '#FCD34D', dot: '#FBBF24' },
  rateLimited: { label: 'Rate Limited', bg: '#3B1D1D', text: '#FCA5A5', dot: '#F87171' },
  done:        { label: 'Done',         bg: '#12372A', text: '#6EE7B7', dot: '#34D399' },
  error:       { label: 'Error',        bg: '#3B1D1D', text: '#FCA5A5', dot: '#F87171' }
};

const SETUP_STYLE = { label: 'Setup Needed', bg: '#3A2E10', text: '#FCD34D', dot: '#FBBF24' };
const FALLBACK_STYLE = { label: 'Unknown', bg: '#1E293B', text: '#CBD5E1', dot: '#94A3B8' };

function isPlanSetup(project) {
  return Boolean(project && project.error && String(project.error).indexOf('plan.md:') === 0);
}

function statusStyle(project) {
  if (isPlanSetup(project)) return { ...SETUP_STYLE };
  const status = String((project && project.status) || 'idle');
  const found = STATUS_STYLES[status];
  if (found) return { ...found };
  return { ...FALLBACK_STYLE, label: status };
}

// "opencode · omniroute/auto/coding". Active steps win; idle cards fall back to
// the configured runner list and effective model, matching the dashboard card.
function runnerModelText(project) {
  const runners = String(project.activeRunner || project.runner || project.effectiveRunners || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const runner = runners.length > 1 ? runners.join(' + ') : (runners[0] || '');
  const model = String(project.activeModel || project.effectiveModel || '').trim();

  if (!runner && !model) return '';
  return (runner || 'runner') + ' · ' + (model || 'default');
}

function normalize(value) {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function findProject(projects, needle) {
  const wanted = normalize(needle);
  if (!wanted) return null;
  return projects.find((project) =>
    normalize(project.id) === wanted ||
    normalize(project.name) === wanted ||
    normalize(project.path) === wanted
  ) || null;
}

// With no parameter the widget tracks whatever is happening: a genuinely running
// project, then one waiting on a rate limit, then the first card. Non-progressing
// states (rate-limited/error/done) stay active-but-stuck, so they must not win
// over a project that is actually making progress.
function pickProject(projects) {
  return projects.find((project) => project.active && !project.paused && project.status !== 'rateLimited' && project.status !== 'error' && project.status !== 'done') ||
    projects.find((project) => project.status === 'rateLimited') ||
    projects[0] ||
    null;
}

function buildCard(project, now) {
  const badge = statusStyle(project);
  const total = Number(project.progress && project.progress.total) || 0;
  const completed = Number(project.progress && project.progress.completed) || 0;
  const resumeAt = Number(project.resumeAt) || 0;
  const retryInSeconds = project.status === 'rateLimited' && resumeAt > now
    ? Math.ceil((resumeAt - now) / 1000)
    : 0;
  const error = isPlanSetup(project)
    ? ''
    : String(project.error || '').split('\n')[0];

  return {
    id: project.id,
    name: project.name || project.id,
    path: project.path || '',
    status: String(project.status || 'idle'),
    badge,
    currentTask: project.currentTask || '',
    nextTask: project.nextTask || '',
    error,
    runner: {
      text: runnerModelText(project),
      active: Boolean(project.activeModel)
    },
    progress: { completed, total },
    active: Boolean(project.active),
    paused: Boolean(project.paused),
    resumeAt: retryInSeconds > 0 ? resumeAt : 0,
    retryInSeconds,
    iconPath: project.id ? '/api/projects/' + encodeURIComponent(project.id) + '/icon.png' : '',
    iconVersion: project.iconVersion || '',
    href: '/'
  };
}

function buildPayload(projects, options = {}) {
  const list = Array.isArray(projects) ? projects : [];
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const needle = String(options.project || '').trim();
  const selected = needle ? findProject(list, needle) : pickProject(list);

  return {
    ok: true,
    updatedAt: new Date(now).toISOString(),
    project: selected ? buildCard(selected, now) : null,
    choose: !selected,
    projects: list.map((project) => ({
      id: project.id,
      name: project.name || project.id,
      path: project.path || '',
      status: String(project.status || 'idle'),
      label: statusStyle(project).label
    }))
  };
}

module.exports = {
  STATUS_STYLES,
  buildCard,
  buildPayload,
  findProject,
  isPlanSetup,
  pickProject,
  runnerModelText,
  statusStyle
};
