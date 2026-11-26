#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const engine = require('../src/engine');

const PROMPT = 'HEADER\n---\nImplement the task with raw docker compose up.\n---\nTAIL';

function makeDir({ looparr }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-promotion-rule-'));
  if (looparr) {
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'scripts', 'restart-looparr.js'), '// test\n');
    fs.writeFileSync(path.join(dir, 'scripts', 'promote.sh'), '#!/bin/sh\n');
  }
  return dir;
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

(function looparrRepo() {
  const dir = makeDir({ looparr: true });
  try {
    assert.equal(engine.usesLooparrPromotion(dir), true, 'detects the looparr repo by its promotion scripts');
    const out = engine.injectPromotionRule(PROMPT, dir);
    assert.equal(count(out, 'Promotion execution'), 2, 'rule appears twice');
    assert.ok(out.indexOf('Promotion execution') < out.indexOf('HEADER'), 'first copy precedes the handoff');
    assert.ok(out.lastIndexOf('Promotion execution') > out.indexOf('TAIL'), 'last copy follows the prompt');
    assert.match(out, /systemd-run --user --wait --collect/);
    assert.match(out, /npm run restart:looparr -- --dry-run/);
    assert.match(out, /exit 137/);
    assert.ok(out.includes(PROMPT), 'original prompt is unchanged');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

(function otherProject() {
  const dir = makeDir({ looparr: false });
  try {
    assert.equal(engine.usesLooparrPromotion(dir), false, 'other projects are not treated as looparr');
    assert.equal(engine.injectPromotionRule(PROMPT, dir), PROMPT, 'no rule leaks into other projects');
    assert.equal(engine.injectPromotionRule(PROMPT, ''), PROMPT, 'empty path is untouched');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

console.log('test-promotion-rule-injection: ok');
