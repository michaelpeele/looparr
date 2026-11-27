'use strict';

const fs = require('fs');
const path = require('path');

const TASK_RE = /^(\s*[-*+]\s+\[)([ xX])(\]\s*)(.*)$/;
const DEPENDENCY_SUFFIX_RE = /\s*\(depends:\s*([^)]*)\)\s*$/i;
// Trailing bracket tokens: [sprint:<name>], [merge-previous], [deploy-main].
// Only these three keys are consumed; unknown bracket tokens stay in the text
// so old or third-party plans keep parsing unchanged.
const SPRINT_TOKEN_RE = /\s*\[sprint:([^\]]*)\]\s*$/i;
const MERGE_PREVIOUS_TOKEN_RE = /\s*\[merge-previous\]\s*$/i;
const DEPLOY_MAIN_TOKEN_RE = /\s*\[deploy-main\]\s*$/i;
const RECOVER_TOKEN_RE = /\s*\[recover\]\s*$/i;
// "(validation: Backend) [Backend] Validation" prefix marker, parsed the same
// way as "(plan)". The marker stays in the task text for the agent (Q7).
const VALIDATION_TASK_MARKER_RE = /^\(validation:\s*([^)\s][^)]*)\)\s(?:|$)/i;

function parseTaskTokens(text) {
  const value = String(text);
  let working = value;
  let sprint = '';
  let mergePrevious = false;
  let deployMain = false;
  let recover = false;
  for (;;) {
    const sprintMatch = working.match(SPRINT_TOKEN_RE);
    if (sprintMatch) {
      sprint = sprintMatch[1].trim();
      working = working.slice(0, sprintMatch.index).trimEnd();
      continue;
    }
    const mergeMatch = working.match(MERGE_PREVIOUS_TOKEN_RE);
    if (mergeMatch) {
      mergePrevious = true;
      working = working.slice(0, mergeMatch.index).trimEnd();
      continue;
    }
    const deployMatch = working.match(DEPLOY_MAIN_TOKEN_RE);
    if (deployMatch) {
      deployMain = true;
      working = working.slice(0, deployMatch.index).trimEnd();
      continue;
    }
    const recoverMatch = working.match(RECOVER_TOKEN_RE);
    if (recoverMatch) {
      recover = true;
      working = working.slice(0, recoverMatch.index).trimEnd();
      continue;
    }
    break;
  }
  return { text: working, sprint, mergePrevious, deployMain, recover };
}

// Cropped task view: dependency suffix plus sprint/merge tokens, all in one
// place so parseTasks and editTask agree on what is metadata.
// Cropped task view: dependency suffix plus sprint/merge tokens, all in one
// place so parseTasks and editTask agree on what is metadata. Suffix and
// tokens alternate-strip so '[sprint:x] (depends: 1)' parses too.
function parseTaskMetadata(text) {
  const firstDeps = parseDependencySuffix(text);
  const firstTokens = parseTaskTokens(firstDeps.text);
  const lastDeps = parseDependencySuffix(firstTokens.text);
  const lastTokens = parseTaskTokens(lastDeps.text);
  return {
    text: lastTokens.text,
    deps: lastDeps.deps.length ? lastDeps.deps : firstDeps.deps,
    dependencySuffix: lastDeps.suffix || firstDeps.suffix,
    dependencyIssue: lastDeps.issue || firstDeps.issue,
    sprint: firstTokens.sprint || lastTokens.sprint,
    mergePrevious: firstTokens.mergePrevious || lastTokens.mergePrevious,
    deployMain: firstTokens.deployMain || lastTokens.deployMain,
    recover: firstTokens.recover || lastTokens.recover
  };
}

function parseDependencySuffix(text) {
  const value = String(text);
  const match = value.match(DEPENDENCY_SUFFIX_RE);
  if (!match) return { text: value, deps: [], suffix: '', issue: '' };
  const tokens = match[1].split(',').map((token) => token.trim()).filter(Boolean);
  const deps = [];
  let issue = '';
  if (!tokens.length) issue = 'dependency list is empty';
  tokens.forEach((token) => {
    const number = token.match(/^#?(\d+)$/);
    if (!number || Number(number[1]) < 1) {
      issue = issue || `invalid dependency "${token}"; use positive checklist numbers`;
      return;
    }
    const dep = Number(number[1]) - 1;
    if (!deps.includes(dep)) deps.push(dep);
  });
  return {
    text: value.slice(0, match.index).trimEnd(),
    deps,
    suffix: match[0].trim(),
    issue
  };
}

function parseTasks(content) {
  const lines = String(content).split(/\r?\n/);
  const tasks = [];
  lines.forEach((line, lineIndex) => {
    const match = line.match(TASK_RE);
    if (!match) return;
    const parsed = parseTaskMetadata(match[4].trim());
    tasks.push({
      index: tasks.length,
      line: lineIndex,
      checked: match[2].toLowerCase() === 'x',
      text: parsed.text,
      raw: line,
      deps: parsed.deps,
      dependencySuffix: parsed.dependencySuffix,
      dependencyIssue: parsed.dependencyIssue,
      sprint: parsed.sprint,
      mergePrevious: parsed.mergePrevious,
      deployMain: parsed.deployMain,
      recover: parsed.recover
    });
  });
  return tasks;
}

function findDependencyCycles(tasks) {
  const state = new Array(tasks.length).fill(0);
  const stack = [];
  const cycles = [];
  const seen = new Set();

  function visit(index) {
    state[index] = 1;
    stack.push(index);
    for (const dep of tasks[index].deps || []) {
      if (dep < 0 || dep >= tasks.length || state[dep] === 2) continue;
      if (state[dep] === 1) {
        const cycle = stack.slice(stack.indexOf(dep)).concat(dep).map((item) => item + 1);
        const key = cycle.join('>');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else {
        visit(dep);
      }
    }
    stack.pop();
    state[index] = 2;
  }

  for (let index = 0; index < tasks.length; index += 1) {
    if (state[index] === 0) visit(index);
  }
  return cycles;
}

function analyzeDependencies(tasks) {
  const cycles = findDependencyCycles(tasks);
  const cycleMembers = new Set();
  cycles.forEach((cycle) => cycle.forEach((item) => cycleMembers.add(item - 1)));
  const issues = [];
  const views = tasks.map((task) => {
    const dependencies = (task.deps || []).map((dep) => dep + 1);
    const missing = (task.deps || [])
      .filter((dep) => dep < 0 || dep >= tasks.length)
      .map((dep) => dep + 1);
    const pending = (task.deps || [])
      .filter((dep) => dep >= 0 && dep < tasks.length && !tasks[dep].checked)
      .map((dep) => dep + 1);
    const inCycle = cycleMembers.has(task.index);
    let reason = '';
    if (task.dependencyIssue) {
      reason = `invalid dependency: ${task.dependencyIssue}`;
      issues.push(`Checklist item ${task.index + 1}: ${reason}`);
    }
    if (missing.length) {
      reason = reason || `dependency #${missing[0]} does not exist`;
      missing.forEach((dep) => issues.push(`Checklist item ${task.index + 1} depends on missing task #${dep}`));
    }
    if (inCycle && !reason) {
      const cycle = cycles.find((entry) => entry.includes(task.index + 1)) || [];
      reason = `dependency cycle detected: ${cycle.join(' -> ')}`;
    }
    if (!reason && pending.length) {
      reason = pending.length === 1
        ? `waiting on dependency #${pending[0]}`
        : `waiting on dependencies ${pending.map((dep) => `#${dep}`).join(', ')}`;
    }
    return {
      index: task.index,
      dependencies,
      pending,
      missing,
      cycle: inCycle,
      blocked: Boolean(reason),
      reason
    };
  });
  const cycleErrors = cycles.map((cycle) => `dependency cycle detected: ${cycle.join(' -> ')}`);
  const errorParts = issues.concat(cycleErrors);
  return {
    ok: errorParts.length === 0,
    error: errorParts.join('; '),
    issues,
    cycles,
    tasks: views
  };
}

function firstUnchecked(tasks) {
  return tasks.find((task) => !task.checked) || null;
}

function nextUncheckedAfter(tasks, fromIndex) {
  return tasks.find((task) => !task.checked && task.index > fromIndex) || null;
}

function stats(tasks) {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.checked).length;
  return { total, completed };
}

function readPlan(projectDir) {
  const planPath = path.join(projectDir, 'plan.md');
  try {
    const content = fs.readFileSync(planPath, 'utf8');
    const tasks = parseTasks(content);
    return {
      ok: true,
      planPath,
      content,
      tasks,
      next: firstUnchecked(tasks),
      stats: stats(tasks),
      dependencyStatus: analyzeDependencies(tasks)
    };
  } catch (error) {
    return {
      ok: false,
      planPath,
      content: '',
      tasks: [],
      next: null,
      stats: stats([]),
      dependencyStatus: analyzeDependencies([]),
      error: error.message
    };
  }
}

function setChecked(content, index, checked) {
  const tasks = parseTasks(content);
  const task = tasks[index];
  if (!task) return { ok: false, error: `No checklist item at index ${index}` };
  const lines = String(content).split(/\r?\n/);
  const match = lines[task.line].match(TASK_RE);
  if (!match) return { ok: false, error: `Checklist item ${index} changed on disk` };
  lines[task.line] = `${match[1]}${checked ? 'x' : ' '}${match[3]}${match[4]}`;
  return { ok: true, content: lines.join('\n') };
}

function taskEditTarget(content, index) {
  const taskIndex = Number(index);
  if (!Number.isInteger(taskIndex) || taskIndex < 0) return null;
  const tasks = parseTasks(content);
  const task = tasks[taskIndex];
  if (!task) return null;
  const lines = String(content).split('\n');
  const raw = lines[task.line];
  const lineEnding = raw.endsWith('\r') ? '\r' : '';
  const match = raw.slice(0, raw.length - lineEnding.length).match(TASK_RE);
  if (!match) return null;
  return { lines, task, match, lineEnding };
}

function normalizeTaskText(text) {
  if (text === undefined || text === null) return '';
  return String(text).trim().replace(/\s+/g, ' ').trim();
}

function editTask(content, index, newText) {
  const target = taskEditTarget(content, index);
  if (!target) return { ok: false, error: `No checklist item at index ${index}` };
  const normalized = normalizeTaskText(newText);
  if (!normalized) return { ok: false, error: 'Task text is required' };
  const incoming = parseTaskMetadata(normalized);
  // Tokens the caller stripped or never sent ride in from the existing line so
  // a plain text edit can never drop sprint membership or merge flags (R10).
  // Tokens the caller explicitly sent on the new line win over the old ones so
  // an API edit can add or drop a flag.
  const explicit = Boolean(incoming.dependencySuffix || incoming.sprint || incoming.mergePrevious || incoming.deployMain || incoming.recover)
    || normalized === target.task.text;
  const text = explicit ? incoming.text : normalized;
  if (!text) return { ok: false, error: 'Task text is required' };
  const parts = [text];
  const deployMain = explicit ? incoming.deployMain : target.task.deployMain;
  if (deployMain) parts.push('[deploy-main]');
  const mergePrevious = explicit ? incoming.mergePrevious : target.task.mergePrevious;
  if (mergePrevious) parts.push('[merge-previous]');
  const recover = explicit ? incoming.recover : target.task.recover;
  if (recover) parts.push('[recover]');
  const sprint = incoming.sprint || target.task.sprint || '';
  if (sprint) parts.push(`[sprint:${sprint}]`);
  const suffix = incoming.dependencySuffix || target.task.dependencySuffix || '';
  if (suffix) parts.push(suffix);
  const line = parts.join(' ');
  target.lines[target.task.line] = `${target.match[1]}${target.match[2]}${target.match[3]}${line}${target.lineEnding}`;
  return { ok: true, content: target.lines.join('\n') };
}

function removeTask(content, index) {
  const target = taskEditTarget(content, index);
  if (!target) return { ok: false, error: `No checklist item at index ${index}` };
  target.lines.splice(target.task.line, 1);
  return { ok: true, content: target.lines.join('\n') };
}

function markTask(content, text, checked = true) {
  const tasks = parseTasks(content);
  const wanted = String(text).trim();
  const task = tasks.find((item) => item.text === wanted && item.checked !== checked);
  if (!task) return { ok: true, content, changed: false };
  return { ...setChecked(content, task.index, checked), changed: true };
}

function writePlan(projectDir, content) {
  const planPath = path.join(projectDir, 'plan.md');
  const temp = `${planPath}.looparr.tmp`;
  fs.writeFileSync(temp, String(content), 'utf8');
  fs.renameSync(temp, planPath);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function utcTimestamp(date = new Date()) {
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate())
  ].join('') + '-' + [pad2(date.getUTCHours()), pad2(date.getUTCMinutes()), pad2(date.getUTCSeconds())].join('');
}

function nextArchiveName(docsDir, base) {
  let candidate = `PLAN-${base}.md`;
  let suffix = 2;
  while (fs.existsSync(path.join(docsDir, candidate))) {
    candidate = `PLAN-${base}-${suffix}.md`;
    suffix += 1;
  }
  return candidate;
}

function archivePlan(projectDir, options = {}) {
  const clear = options.clear !== false;
  const planPath = path.join(projectDir, 'plan.md');
  let content;
  try {
    content = fs.readFileSync(planPath, 'utf8');
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return { ok: false, error: 'plan.md not found' };
    }
    return { ok: false, error: error.message };
  }
  if (!String(content).trim()) {
    return { ok: false, error: 'plan.md is empty' };
  }

  const docsDir = path.join(projectDir, '.project_documents');
  try {
    fs.mkdirSync(docsDir, { recursive: true });
  } catch (error) {
    return { ok: false, error: error.message };
  }

  const archiveName = nextArchiveName(docsDir, utcTimestamp());
  const archivePath = path.join(docsDir, archiveName);
  const archiveRelativePath = path.posix.join('.project_documents', archiveName);

  try {
    fs.writeFileSync(archivePath, content, 'utf8');
  } catch (error) {
    return { ok: false, error: error.message };
  }

  try {
    const verified = fs.readFileSync(archivePath, 'utf8');
    if (Buffer.byteLength(verified, 'utf8') !== Buffer.byteLength(content, 'utf8')) {
      return { ok: false, error: 'archive verification failed' };
    }
  } catch (error) {
    return { ok: false, error: error.message };
  }

  if (clear) {
    try {
      writePlan(projectDir, '');
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  return { ok: true, archivePath: archiveRelativePath, archiveName, cleared: clear };
}

// "(plan) Task text" — note `\b` never matches after ')' (non-word to
// non-word), so anchor on whitespace or end-of-string instead.
const PLAN_TASK_MARKER_RE = /^\(plan\)(?:\s|$)/i;

function isPlanTask(task) {
  return PLAN_TASK_MARKER_RE.test(String(task || '').trim());
}

// "(validation: Backend)" prefix — the marker stays in the text the agent sees.
function validationTypeOfText(text) {
  const match = String(text || '').trim().match(VALIDATION_TASK_MARKER_RE);
  return match ? match[1].trim() : '';
}

function isValidationTask(taskOrText) {
  const text = typeof taskOrText === 'string' ? taskOrText : String(taskOrText?.text || '');
  return Boolean(validationTypeOfText(text));
}

function sprintOfTask(task) {
  if (task && typeof task === 'object' && typeof task.sprint === 'string') return task.sprint;
  return parseTaskTokens(String(task?.text ?? task ?? '')).sprint;
}

function taskFlags(task) {
  const text = typeof task === 'string' ? task : String(task?.text ?? '');
  const tokens = parseTaskTokens(
    typeof task === 'object' && task !== null && typeof task.text === 'string'
      ? joinTaskTokens(task)
      : text
  );
  return {
    sprint: typeof task === 'object' && task !== null && typeof task.sprint === 'string'
      ? task.sprint
      : tokens.sprint,
    mergePrevious: task?.mergePrevious === true || tokens.mergePrevious,
    deployMain: task?.deployMain === true || tokens.deployMain,
    recover: task?.recover === true || tokens.recover,
    validationType: validationTypeOfText(tasks_text(task, text))
  };
}

// Text carrying only the bracket tokens, rebuilt from a parsed task when a
// caller hands us one (flags live outside .text after parseTasks).
function joinTaskTokens(task) {
  const parts = [task.text];
  if (task.mergePrevious) parts.push('[merge-previous]');
  if (task.deployMain) parts.push('[deploy-main]');
  if (task.recover) parts.push('[recover]');
  if (task.sprint) parts.push(`[sprint:${task.sprint}]`);
  if (task.dependencySuffix) parts.push(task.dependencySuffix);
  return parts.join(' ');
}

function tasks_text(task, fallback) {
  if (typeof task === 'object' && task !== null && typeof task.text === 'string') return task.text;
  return fallback;
}

module.exports = {
  TASK_RE,
  PLAN_TASK_MARKER_RE,
  VALIDATION_TASK_MARKER_RE,
  parseTasks,
  parseDependencySuffix,
  parseTaskTokens,
  isPlanTask,
  isValidationTask,
  validationTypeOfText,
  sprintOfTask,
  taskFlags,
  joinTaskTokens,
  analyzeDependencies,
  firstUnchecked,
  nextUncheckedAfter,
  stats,
  readPlan,
  setChecked,
  editTask,
  removeTask,
  markTask,
  writePlan,
  archivePlan
};
