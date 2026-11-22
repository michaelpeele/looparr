'use strict';

const fs = require('fs');
const path = require('path');

const TASK_RE = /^(\s*[-*+]\s+\[)([ xX])(\]\s*)(.*)$/;
const DEPENDENCY_SUFFIX_RE = /\s*\(depends:\s*([^)]*)\)\s*$/i;

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
    const parsed = parseDependencySuffix(match[4].trim());
    tasks.push({
      index: tasks.length,
      line: lineIndex,
      checked: match[2].toLowerCase() === 'x',
      text: parsed.text,
      raw: line,
      deps: parsed.deps,
      dependencySuffix: parsed.suffix,
      dependencyIssue: parsed.issue
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
  const parsed = parseDependencySuffix(normalized);
  const text = parsed.suffix ? parsed.text : normalized;
  if (!text) return { ok: false, error: 'Task text is required' };
  const suffix = parsed.suffix || target.task.dependencySuffix || '';
  const spacing = suffix ? ' ' : '';
  target.lines[target.task.line] = `${target.match[1]}${target.match[2]}${target.match[3]}${text}${spacing}${suffix}${target.lineEnding}`;
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

module.exports = {
  TASK_RE,
  parseTasks,
  parseDependencySuffix,
  analyzeDependencies,
  firstUnchecked,
  nextUncheckedAfter,
  stats,
  readPlan,
  setChecked,
  editTask,
  removeTask,
  markTask,
  writePlan
};
