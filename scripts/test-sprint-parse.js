'use strict';

const assert = require('node:assert/strict');

const REPO_ROOT = require('node:path').resolve(__dirname, '..');
const plan = require(`${REPO_ROOT}/src/plan`);

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function testTokenParseAndStrip() {
  const content = [
    '# Plan',
    '- [ ] Add API endpoint [sprint:backend]',
    '- [ ] Style the header [sprint:frontend] [merge-previous]',
    '- [x] Ship config [deploy-main]',
    '- [ ] Both flags [merge-previous] [deploy-main] [sprint:docs]'
  ].join('\n');
  const tasks = plan.parseTasks(content);
  assertEqual(tasks[0].text, 'Add API endpoint', 'sprint token stripped from text');
  assertEqual(tasks[0].sprint, 'backend', 'sprint name parsed');
  assertEqual(tasks[0].mergePrevious, false, 'no merge-previous on task 1');
  assertEqual(tasks[1].sprint, 'frontend', 'second sprint parsed');
  assertEqual(tasks[1].mergePrevious, true, 'merge-previous parsed');
  assertEqual(tasks[1].deployMain, false, 'deploy-main absent on task 2');
  assertEqual(tasks[2].checked, true, 'checked state intact');
  assertEqual(tasks[2].deployMain, true, 'deploy-main parsed');
  assertEqual(tasks[3].mergePrevious && tasks[3].deployMain, true, 'both flags on task 4');
  assertEqual(tasks[3].sprint, 'docs', 'sprint after other tokens parsed');
}

function testOldPlansWithoutTokens() {
  const content = '- [ ] Legacy task plain\n- [x] Done task (depends: 1)';
  const tasks = plan.parseTasks(content);
  assertEqual(tasks[0].sprint, '', 'no sprint on legacy task');
  assertEqual(tasks[0].mergePrevious, false, 'no merge-previous on legacy task');
  assertEqual(tasks[0].deployMain, false, 'no deploy-main on legacy task');
  assertEqual(tasks[0].text, 'Legacy task plain', 'legacy text untouched');
  assertEqual(tasks[1].dependencySuffix, '(depends: 1)', 'dependency suffix still parsed');
}

function testUnknownBracketTokensStay() {
  const content = '- [ ] Weird task [blocked: 3]';
  const tasks = plan.parseTasks(content);
  assert.ok(tasks[0].text.includes('[blocked: 3]'), 'unknown bracket token stays in text');
  assertEqual(tasks[0].sprint, '', 'unknown token is not a sprint');
}

function testTokenOrderIndependence() {
  const tasks = plan.parseTasks('- [ ] Either order [sprint:backend] (depends: 1)');
  assertEqual(tasks[0].text, 'Either order', 'both metadata forms stripped before the suffix');
  assertEqual(tasks[0].sprint, 'backend', 'sprint parsed when it precedes the dependency suffix');
  assertEqual(tasks[0].dependencySuffix, '(depends: 1)', 'dependency suffix still parsed');
  assert.deepEqual(tasks[0].deps, [0], 'dependency indexes parsed');
}

function testValidationMarker() {
  assert.ok(plan.VALIDATION_TASK_MARKER_RE.test('(validation: Backend) [Backend] Validation'), 'marker regex matches validation prefix');
  assert.ok(!plan.VALIDATION_TASK_MARKER_RE.test('(plan) Implement the thing'), 'marker regex rejects plain (plan) tasks');
  assertEqual(plan.validationTypeOfText('(validation: Sprint) Sprint Validation [sprint:core]'), 'Sprint', 'validation type extracted');
  assertEqual(plan.validationTypeOfText('Just a task'), '', 'no type for normal tasks');
  assertEqual(plan.isValidationTask({ text: '(validation: Docs) Docs Validation' }), true, 'isValidationTask true for validation task');
  assertEqual(plan.isValidationTask({ text: 'Normal task' }), false, 'isValidationTask false for normal task');
}

function testSprintOfTaskAndFlags() {
  const parsed = plan.parseTasks('- [ ] Task A [sprint:backend] [deploy-main]');
  assertEqual(plan.sprintOfTask(parsed[0]), 'backend', 'sprintOfTask from parsed task');
  assertEqual(plan.sprintOfTask('Raw text [sprint:frontend]'), 'frontend', 'sprintOfTask from raw string');
  const flags = plan.taskFlags(parsed[0]);
  assertEqual(flags.sprint, 'backend', 'taskFlags sprint');
  assertEqual(flags.mergePrevious, false, 'taskFlags mergePrevious');
  assertEqual(flags.deployMain, true, 'taskFlags deployMain');
  assertEqual(flags.validationType, '', 'taskFlags validationType empty');
  const validation = plan.taskFlags({ text: '(validation: Backend) [Backend] Validation', sprint: 'backend' });
  assertEqual(validation.validationType, 'Backend', 'taskFlags validation type');
}

function testJoinTokensAndEditRoundTrip() {
  const parsed = plan.parseTasks('- [ ] Edit me [sprint:backend] [merge-previous]');
  assertEqual(parsed[0].sprint, 'backend', 'parsed before edit');
  const edit = plan.editTask('- [ ] Edit me [sprint:backend] [merge-previous]', 0, 'Renamed task');
  assert.ok(edit.ok, 'editTask succeeds');
  const edited = plan.parseTasks(edit.content);
  assertEqual(edited[0].text, 'Renamed task', 'text updated');
  assertEqual(edited[0].sprint, 'backend', 'sprint token preserved');
  assertEqual(edited[0].mergePrevious, true, 'merge-previous token preserved');
  // Token flip through the same edit path (task toggle behavior).
  const flipped = plan.editTask(edit.content, 0, 'Renamed task [merge-previous] [deploy-main] [sprint:backend]');
  const afterFlip = plan.parseTasks(flipped.content);
  assertEqual(afterFlip[0].mergePrevious, true, 'merge-previous kept');
  assertEqual(afterFlip[0].deployMain, true, 'deploy-main added');
  assertEqual(afterFlip[0].sprint, 'backend', 'sprint kept');
  // Toggling the last flag off sends the bare task text; flags drop while the
  // sprint membership and dependency suffix survive.
  const toggledOff = plan.editTask(flipped.content, 0, 'Renamed task');
  const afterToggleOff = plan.parseTasks(toggledOff.content);
  assertEqual(afterToggleOff[0].mergePrevious, false, 'merge-previous removed by bare-text toggle');
  assertEqual(afterToggleOff[0].deployMain, false, 'deploy-main removed by bare-text toggle');
  assertEqual(afterToggleOff[0].sprint, 'backend', 'sprint survives flag removal');
  // Checklist index untouched: two-task plan, edit only item 2.
  const two = '- [ ] First task\n- [ ] Second task [sprint:ui]';
  const edit2nd = plan.editTask(two, 1, 'Second renamed');
  const lines = edit2nd.content.split('\n');
  assertEqual(lines[0], '- [ ] First task', 'first line unchanged');
  assert.ok(lines[1].includes('[sprint:ui]'), 'second line keeps token');
}

function testJoinTaskTokens() {
  assertEqual(plan.joinTaskTokens({ text: 'A', sprint: 'backend', mergePrevious: true, deployMain: false }), 'A [merge-previous] [sprint:backend]', 'join rebuilds token text');
}

let pass = 0;
function run(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}`);
    throw error;
  }
}

run('token parse/strip', testTokenParseAndStrip);
run('old plans without tokens', testOldPlansWithoutTokens);
run('unknown bracket tokens stay', testUnknownBracketTokensStay);
run('token order independent of dependency suffix', testTokenOrderIndependence);
run('validation marker', testValidationMarker);
run('sprintOfTask/taskFlags', testSprintOfTaskAndFlags);
run('editTask round-trip', testJoinTokensAndEditRoundTrip);
run('joinTaskTokens', testJoinTaskTokens);

console.log(`test-sprint-parse: ${pass} assertions groups passed`);
