'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-test-plan-helpers');
const planLib = require(path.join(REPO_ROOT, 'src/plan.js'));

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertIncludes(text, fragment, label) {
  assert.ok(text.includes(fragment), `${label}: missing ${JSON.stringify(fragment)}`);
}

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `Missing function: ${signature}`);
  const braceStart = source.indexOf('{', start);
  assert.ok(braceStart >= 0, `Missing function body: ${signature}`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unbalanced function body: ${signature}`);
}

function tasksFrom(markdown) {
  return planLib.parseTasks(markdown);
}

function nextText(tasks, fromIndex) {
  const next = planLib.nextUncheckedAfter(tasks, fromIndex);
  return next ? next.text : null;
}

function testTaskEdits() {
  for (const name of ['editTask', 'removeTask']) {
    assertIncludes(Object.keys(planLib).join(','), name, 'plan exports');
  }

  const crlf = [
    '# Plan',
    '',
    '- [x] done',
    '  * [ ] indented',
    'note between lines',
    '+ [X] Upper',
    ''
  ].join('\r\n');
  const editedCrlf = planLib.editTask(crlf, 1, '  New   text  ');
  assertEqual(editedCrlf.ok, true, 'edit CRLF task ok');
  assertEqual(
    editedCrlf.content,
    crlf.replace('  * [ ] indented', '  * [ ] New text'),
    'edit preserves CRLF, indent, marker and check state'
  );
  const removedCrlf = planLib.removeTask(crlf, 1);
  assertEqual(removedCrlf.ok, true, 'remove CRLF task ok');
  assertEqual(
    removedCrlf.content,
    crlf.replace('  * [ ] indented\r\n', ''),
    'remove only target line and keep surrounding lines'
  );

  const lf = '- [ ] one\n- [x] two\n';
  assertEqual(planLib.editTask(lf, 0, 'alpha').content, '- [ ] alpha\n- [x] two\n', 'edit LF task');
  assertEqual(planLib.removeTask(lf, 1).content, '- [ ] one\n', 'remove LF task');

  const bullets = '* [ ] star\n+ [X] plus\n- [x] dash\n';
  assertEqual(planLib.editTask(bullets, 0, 'a').content, '* [ ] a\n+ [X] plus\n- [x] dash\n', 'star bullet edit');
  assertEqual(planLib.editTask(bullets, 1, 'b').content, '* [ ] star\n+ [X] b\n- [x] dash\n', 'plus bullet and X state edit');
  assertEqual(planLib.editTask(bullets, 2, 'c').content, '* [ ] star\n+ [X] plus\n- [x] c\n', 'dash bullet and x state edit');

  for (const index of [-1, 1.5, 99]) {
    assertEqual(planLib.editTask(lf, index, 'x').ok, false, `edit invalid index ${index}`);
    assertEqual(planLib.removeTask(lf, index).ok, false, `remove invalid index ${index}`);
  }
  const blank = planLib.editTask(lf, 0, '  \n ');
  assertEqual(blank.ok, false, 'blank edit rejected');
  assertEqual(blank.error, 'Task text is required', 'blank edit error');
  assertEqual(lf, '- [ ] one\n- [x] two\n', 'failed edit leaves source unchanged');

  const duplicate = '- [ ] same\n- [ ] same\n- [ ] other\n';
  assertEqual(planLib.removeTask(duplicate, 1).content, '- [ ] same\n- [ ] other\n', 'remove only target duplicate');
}

function loadLinkDocHelpers() {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'public/app.js'), 'utf8');
  const prefixMatch = source.match(/^\s*const PLAN_FILE_PREFIXES = '([^']+)';$/m);
  assert.ok(prefixMatch, 'Missing PLAN_FILE_PREFIXES');
  const prefixes = prefixMatch[1];
  const slug = extractFunction(source, 'function buildTaskSlug(title)');
  const format = extractFunction(source, 'function formatLinkedTask(title, file)');
  const resolve = extractFunction(source, 'async function resolveLinkedDocName(title, override, fileExists)');
  const factory = new Function([`const PLAN_FILE_PREFIXES = '${prefixes}';`, slug, format, resolve, 'return { buildTaskSlug, formatLinkedTask, resolveLinkedDocName };'].join('\n'));
  return { ...factory(), PREFIXES: prefixes };
}

async function testLinkDocHelpers() {
  const { buildTaskSlug, formatLinkedTask, resolveLinkedDocName, PREFIXES } = loadLinkDocHelpers();
  assertEqual(PREFIXES, 'PLAN|plan|PROMPT|prompt|ANALYSIS|analysis|RESEARCH|research|INVESTIGATION|investigation|HANDOFF|handoff|PROGRESS|progress', 'shared prefix list');

  assertEqual(buildTaskSlug('Task link checkbox'), 'task-link-checkbox', 'slug basic');
  assertEqual(buildTaskSlug('(plan) Task link checkbox'), 'task-link-checkbox', 'slug strips leading (plan)');
  assertEqual(buildTaskSlug('Hello, World!'), 'hello-world', 'slug punctuation');
  assertEqual(buildTaskSlug('!!!'), 'task', 'slug fallback');
  assertEqual(buildTaskSlug('a b c'), 'a-b-c', 'slug spaces');
  const long = 'a'.repeat(100);
  assertEqual(buildTaskSlug(long).length, 60, 'slug capped at 60');
  assert.ok(!buildTaskSlug(long).endsWith('-'), 'slug not trailing dash');

  const expectedLink = '(plan) Task link checkbox \u2014 see [PLAN-task-link-checkbox.md](.project_documents/PLAN-task-link-checkbox.md)';
  assertEqual(formatLinkedTask('Task link checkbox', 'PLAN-task-link-checkbox.md'), expectedLink, 'format linked task');

  const neverExists = async () => false;
  assertEqual(await resolveLinkedDocName('Task link checkbox', undefined, neverExists), 'PLAN-task-link-checkbox.md', 'auto-derived missing doc');

  const collisions = {};
  const existing = async (name) => Boolean(collisions[name]);
  collisions['PLAN-task-link-checkbox.md'] = true;
  assertEqual(await resolveLinkedDocName('Task link checkbox', undefined, existing), 'PLAN-task-link-checkbox-2.md', 'auto collision uses -2');
  collisions['PLAN-task-link-checkbox-2.md'] = true;
  assertEqual(await resolveLinkedDocName('Task link checkbox', undefined, existing), 'PLAN-task-link-checkbox-3.md', 'auto collision uses -3');
  assertEqual(collisions['PLAN-task-link-checkbox.md'], true, 'original file untouched by collision');

  assertEqual(await resolveLinkedDocName('anything', 'PROGRESS-foo.md', neverExists), 'PROGRESS-foo.md', 'user-typed valid used verbatim');
  assertEqual(await resolveLinkedDocName('anything', 'PLAN-existing.md', () => true), 'PLAN-existing.md', 'user-typed existing reused unchanged');

  for (const bad of ['../x.md', 'foo.txt', 'my file.md', 'FOO-bar.md', '.hidden.md', '-dash.md']) {
    let threw = false;
    try { await resolveLinkedDocName('anything', bad, neverExists); } catch { threw = true; }
    assertEqual(threw, true, `invalid filename rejected: ${bad}`);
  }

  for (const good of ['PLAN-a.md', 'plan-b.md', 'PROMPT-c.md', 'ANALYSIS-d.md', 'RESEARCH-e.md', 'INVESTIGATION-f.md', 'HANDOFF-g.md', 'PROGRESS-h.md']) {
    assertEqual(await resolveLinkedDocName('anything', good, neverExists), good, `valid prefix accepted: ${good}`);
  }
}

function loadReorderHelpers() {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'public/app.js'), 'utf8');
  const lineRegex = source.match(/^\s*const TASK_LINE_RE = .*;$/m);
  assert.ok(lineRegex, 'Missing TASK_LINE_RE');
  const indexes = extractFunction(source, 'function planTaskLineIndexes(content)');
  const reorder = extractFunction(source, 'function reorderPlanTask(content, fromTaskIndex, toTaskIndex)');
  const visibleIndexes = extractFunction(source, 'function visibleTaskIndexes(tasks, showCompleted)');
  const neighbor = extractFunction(source, 'function visibleTaskNeighbor(visibleIndexes, fromTaskIndex, direction)');
  const factory = new Function([
    lineRegex[0],
    indexes,
    reorder,
    visibleIndexes,
    neighbor,
    'return { planTaskLineIndexes, reorderPlanTask, visibleTaskIndexes, visibleTaskNeighbor };'
  ].join('\n'));
  return factory();
}

function testReorderHelpers() {
  const { reorderPlanTask, visibleTaskIndexes, visibleTaskNeighbor } = loadReorderHelpers();

  const buildPlan = (count, checked) => {
    const lines = ['# Plan', ''];
    for (let index = 1; index <= count; index += 1) {
      lines.push(`- [${checked(index - 1) ? 'x' : ' '}] item ${index}`);
    }
    return lines.join('\n');
  };
  const tasksFor = (count, checked) => Array.from({ length: count }, (_, index) => ({
    index,
    checked: checked(index)
  }));
  const taskLinesOf = (content) => content.split('\n').filter((line) => /\[.\]/.test(line));

  const hiddenCompleted = (index) => index > 0 && index < 9;
  const content = buildPlan(10, hiddenCompleted);
  const tasks = tasksFor(10, hiddenCompleted);

  assert.deepEqual(visibleTaskIndexes(tasks, false), [0, 9], 'hidden completed leaves first and last visible');
  assert.deepEqual(visibleTaskIndexes(tasks, true), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'shown completed keeps all visible');

  const visible = visibleTaskIndexes(tasks, false);
  const upTarget = visibleTaskNeighbor(visible, 9, -1);
  assertEqual(upTarget, 0, 'single up from item 10 targets first visible item');
  const movedUp = taskLinesOf(reorderPlanTask(content, 9, upTarget));
  assertEqual(movedUp[0], '- [ ] item 10', 'single up moves item 10 to position 1');
  assertEqual(movedUp[1], '- [ ] item 1', 'item 1 shifts down one visible slot');

  const downTarget = visibleTaskNeighbor(visible, 0, 1);
  assertEqual(downTarget, 9, 'single down from item 1 targets last visible item');
  const movedDown = taskLinesOf(reorderPlanTask(content, 0, downTarget));
  assertEqual(movedDown[movedDown.length - 1], '- [ ] item 1', 'single down moves item 1 to last visible position');
  assertEqual(movedDown[movedDown.length - 2], '- [ ] item 10', 'item 10 shifts up one visible slot');

  assertEqual(visibleTaskNeighbor(visible, 0, -1), null, 'no visible neighbor above first row');
  assertEqual(visibleTaskNeighbor(visible, 9, 1), null, 'no visible neighbor below last row');

  const allVisible = visibleTaskIndexes(tasks, true);
  assertEqual(visibleTaskNeighbor(allVisible, 4, -1), 3, 'shown completed moves up one full position');
  assertEqual(visibleTaskNeighbor(allVisible, 4, 1), 5, 'shown completed moves down one full position');
  const adjacentUp = taskLinesOf(reorderPlanTask(content, 4, 3));
  assertEqual(adjacentUp[3], '- [x] item 5', 'shown completed single up swaps adjacent items');
}

function loadInsertHelpers() {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'public/app.js'), 'utf8');
  const lineRegex = source.match(/^\s*const TASK_LINE_RE = .*;$/m);
  assert.ok(lineRegex, 'Missing TASK_LINE_RE');
  const clean = extractFunction(source, 'function cleanTaskText(value)');
  const indexes = extractFunction(source, 'function planTaskLineIndexes(content)');
  const append = extractFunction(source, 'function appendTask(content, text)');
  const first = extractFunction(source, 'function insertTaskFirst(content, text)');
  const after = extractFunction(source, 'function insertTaskAfter(content, text, targetTaskIndex)');
  const snippet = extractFunction(source, 'function taskSnippet(text)');
  const factory = new Function([
    lineRegex[0],
    clean,
    indexes,
    append,
    first,
    after,
    snippet,
    'return { cleanTaskText, planTaskLineIndexes, appendTask, insertTaskFirst, insertTaskAfter, taskSnippet };'
  ].join('\n'));
  return factory();
}

function testInsertHelpers() {
  const { insertTaskFirst, insertTaskAfter, taskSnippet } = loadInsertHelpers();

  const heading = ['# Plan', '', 'preamble line', '- [ ] one', '- [x] two', ''].join('\n');
  const firstWithHeading = insertTaskFirst(heading, 'new first');
  assertEqual(
    firstWithHeading,
    ['# Plan', '', 'preamble line', '- [ ] new first', '- [ ] one', '- [x] two', ''].join('\n'),
    'insert-first lands before first task and keeps preamble'
  );

  const noTasks = ['# Plan', '', 'only preamble', ''].join('\n');
  assertEqual(
    insertTaskFirst(noTasks, 'solo'),
    ['# Plan', '', 'only preamble', '', '- [ ] solo'].join('\n'),
    'insert-first with no tasks appends at end'
  );
  assertEqual(insertTaskFirst('', 'solo'), '- [ ] solo\n', 'insert-first empty content returns single line');
  assertEqual(insertTaskFirst(heading, '   '), null, 'insert-first empty text returns null');

  const crlf = ['# Plan', '', '- [ ] one', '- [ ] two', ''].join('\r\n');
  assertEqual(
    insertTaskFirst(crlf, 'first'),
    ['# Plan', '', '- [ ] first'].join('\r\n') + '\n' + ['- [ ] one', '- [ ] two', ''].join('\r\n'),
    'insert-first preserves CRLF endings the way appendTask does'
  );

  const list = ['# Plan', '', '- [ ] zero', '- [ ] one', '- [ ] two', ''].join('\n');
  assertEqual(
    insertTaskAfter(list, 'after zero', 0),
    ['# Plan', '', '- [ ] zero', '- [ ] after zero', '- [ ] one', '- [ ] two', ''].join('\n'),
    'insert-after index 0 lands directly after first task'
  );
  assertEqual(
    insertTaskAfter(list, 'after one', 1),
    ['# Plan', '', '- [ ] zero', '- [ ] one', '- [ ] after one', '- [ ] two', ''].join('\n'),
    'insert-after middle index lands after that task'
  );
  assertEqual(insertTaskAfter(list, 'x', 99), null, 'insert-after out-of-range returns null');
  assertEqual(insertTaskAfter(list, 'x', 1.5), null, 'insert-after non-integer returns null');
  assertEqual(insertTaskAfter(list, 'x', -1), null, 'insert-after negative returns null');
  assertEqual(insertTaskAfter(list, '  ', 0), null, 'insert-after empty text returns null');

  assertEqual(taskSnippet('- [ ] Fix the login redirect bug now please'), 'Fix the login redirect bug', 'taskSnippet returns first 5 words');
  assertEqual(taskSnippet('one two'), 'one two', 'taskSnippet keeps short text');
  assertEqual(taskSnippet('   '), '', 'taskSnippet empty returns empty');

  const dupA = taskSnippet('- [ ] same words here repeated');
  const dupB = taskSnippet('- [x] same words here repeated');
  assertEqual(dupA, dupB, 'duplicate task texts share snippet text');
  const duplicateList = ['- [ ] same words here repeated', '- [x] same words here repeated'].join('\n');
  const dupIndexes = loadInsertHelpers().planTaskLineIndexes(duplicateList);
  assertEqual(dupIndexes.length, 2, 'duplicate tasks get distinct line indexes');
  assert.ok(dupIndexes[0] !== dupIndexes[1], 'duplicate snippets map to distinct option values by index');
}

async function main() {
  assertIncludes(Object.keys(planLib).join(','), 'nextUncheckedAfter', 'plan exports');
  testTaskEdits();
  await testLinkDocHelpers();
  testReorderHelpers();
  testInsertHelpers();

  const run = tasksFrom([
    '- [x] zero',
    '- [x] one',
    '- [ ] two',
    '- [ ] three',
    '- [ ] four'
  ].join('\n'));
  assertEqual(nextText(run, 1), 'two', 'lookahead after active index 1');

  const outOfOrder = tasksFrom([
    '- [x] zero',
    '- [x] one',
    '- [ ] two',
    '- [x] three',
    '- [ ] four'
  ].join('\n'));
  assertEqual(nextText(outOfOrder, 2), 'four', 'skips checked item after active index');

  const lastUnchecked = tasksFrom([
    '- [x] zero',
    '- [x] one',
    '- [x] two',
    '- [x] three',
    '- [ ] four'
  ].join('\n'));
  assertEqual(planLib.nextUncheckedAfter(lastUnchecked, 4), null, 'active is last unchecked');
  assertEqual(planLib.nextUncheckedAfter(lastUnchecked, 999), null, 'fromIndex past list');

  const mixed = tasksFrom([
    '- [x] zero',
    '- [ ] one',
    '- [x] two',
    '- [ ] three'
  ].join('\n'));
  const first = planLib.firstUnchecked(mixed);
  assertEqual(first && first.text, 'one', 'first unchecked');
  const idle = planLib.nextUncheckedAfter(mixed, -1);
  assertEqual(idle && idle.text, first.text, 'fromIndex -1 matches firstUnchecked');

  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.writeFileSync(path.join(TEMP_DIR, 'plan.md'), [
    '- [x] done',
    '- [ ] alpha',
    '- [x] done2',
    '- [ ] beta'
  ].join('\n'), 'utf8');
  const plan = planLib.readPlan(TEMP_DIR);
  assertEqual(plan.ok, true, 'readPlan ok');
  assertEqual(plan.next && plan.next.text, 'alpha', 'idle fallback plan.next is first unchecked');

  const oldStyle = tasksFrom('- [ ] alpha\n- [x] beta\n');
  assertEqual(oldStyle[0].text, 'alpha', 'old plan task text unchanged');
  assertEqual(oldStyle[0].deps.length, 0, 'old plan has no dependencies');

  const withDeps = tasksFrom([
    '- [ ] Build',
    '- [ ] Deploy (depends: 1, 3)',
    '- [x] Config',
    '- [ ] Verify (depends: #2, 1)'
  ].join('\n'));
  assertEqual(withDeps[1].text, 'Deploy', 'dependency suffix stripped from task text');
  assertEqual(withDeps[1].deps.join(','), '0,2', 'dependency suffix parsed to 0-based indexes');
  assertEqual(withDeps[1].dependencySuffix, '(depends: 1, 3)', 'dependency suffix retained');
  assertEqual(withDeps[3].deps.join(','), '1,0', 'hash-prefixed dependency parsed and deduped');

  const depContent = [
    '- [x] Build',
    '- [ ] Deploy (depends: 1)'
  ].join('\n');
  const depEdited = planLib.editTask(depContent, 1, 'Ship');
  assertEqual(depEdited.ok, true, 'edit dependency task ok');
  assertEqual(depEdited.content, '- [x] Build\n- [ ] Ship (depends: 1)', 'edit preserves dependency suffix');

  const depPlan = planLib.analyzeDependencies(withDeps);
  assertEqual(depPlan.ok, true, 'pending dependencies are valid');
  assertEqual(depPlan.tasks[1].dependencies.join(','), '1,3', 'dependency view uses 1-based numbers');
  assertEqual(depPlan.tasks[1].pending.join(','), '1', 'completed dependency is not pending');
  assertEqual(depPlan.tasks[1].blocked, true, 'pending dependency blocks task');
  assertIncludes(depPlan.tasks[1].reason, 'waiting on dependency #1', 'pending dependency reason');
  assertEqual(depPlan.tasks[2].blocked, false, 'completed task has no warning');

  const satisfied = planLib.analyzeDependencies(tasksFrom([
    '- [x] Build',
    '- [ ] Deploy (depends: 1)'
  ].join('\n')));
  assertEqual(satisfied.tasks[1].blocked, false, 'completed dependency clears warning');
  assertEqual(satisfied.tasks[1].pending.length, 0, 'completed dependency has no pending list');

  const missing = planLib.analyzeDependencies(tasksFrom([
    '- [ ] alpha',
    '- [ ] beta (depends: 9)'
  ].join('\n')));
  assertEqual(missing.ok, false, 'missing dependency is invalid');
  assertIncludes(missing.error, 'depends on missing task #9', 'missing dependency error');
  assertEqual(missing.tasks[1].missing[0], 9, 'missing dependency reported in task view');
  assertEqual(missing.tasks[1].blocked, true, 'missing dependency blocks task');

  const invalid = planLib.analyzeDependencies(tasksFrom('- [ ] alpha (depends: nope)\n'));
  assertEqual(invalid.ok, false, 'invalid dependency token is rejected');
  assertIncludes(invalid.error, 'invalid dependency "nope"', 'invalid dependency error');

  const cycle = planLib.analyzeDependencies(tasksFrom([
    '- [ ] a (depends: 2)',
    '- [ ] b (depends: 1)'
  ].join('\n')));
  assertEqual(cycle.ok, false, 'dependency cycle is invalid');
  assertIncludes(cycle.error, 'dependency cycle detected: 1 -> 2 -> 1', 'cycle error text');
  assertEqual(cycle.tasks[0].cycle, true, 'cycle member flagged');
  assertEqual(cycle.tasks[1].blocked, true, 'cycle blocks task');
  assertIncludes(cycle.tasks[1].reason, 'dependency cycle detected', 'cycle reason');

  fs.writeFileSync(path.join(TEMP_DIR, 'plan.md'), [
    '- [x] Build',
    '- [ ] Deploy (depends: 1)'
  ].join('\n'), 'utf8');
  const readWithDeps = planLib.readPlan(TEMP_DIR);
  assertEqual(readWithDeps.ok, true, 'readPlan ok with dependencies');
  assertEqual(readWithDeps.next.text, 'Deploy', 'dependency suffix stripped from state next task');
  assertEqual(readWithDeps.dependencyStatus.tasks[1].dependencies[0], 1, 'readPlan exposes dependency state');

  console.log('plan-helpers tests passed');
}

function finish(code) {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  process.exit(code);
}

main()
  .then(() => finish(0))
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    finish(1);
  });
