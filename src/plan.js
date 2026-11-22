'use strict';

const fs = require('fs');
const path = require('path');

const TASK_RE = /^(\s*[-*+]\s+\[)([ xX])(\]\s*)(.*)$/;

function parseTasks(content) {
  const lines = String(content).split(/\r?\n/);
  const tasks = [];
  lines.forEach((line, lineIndex) => {
    const match = line.match(TASK_RE);
    if (!match) return;
    tasks.push({
      index: tasks.length,
      line: lineIndex,
      checked: match[2].toLowerCase() === 'x',
      text: match[4].trim(),
      raw: line
    });
  });
  return tasks;
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
    return { ok: true, planPath, content, tasks, next: firstUnchecked(tasks), stats: stats(tasks) };
  } catch (error) {
    return { ok: false, planPath, content: '', tasks: [], next: null, stats: stats([]), error: error.message };
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

module.exports = { TASK_RE, parseTasks, firstUnchecked, nextUncheckedAfter, stats, readPlan, setChecked, markTask, writePlan };
