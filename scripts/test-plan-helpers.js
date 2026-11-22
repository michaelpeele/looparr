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

async function main() {
  assertIncludes(Object.keys(planLib).join(','), 'nextUncheckedAfter', 'plan exports');
  testTaskEdits();

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
