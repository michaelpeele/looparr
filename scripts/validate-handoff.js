#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { isMetaPromptHandoff } = require('../src/engine');

const target = process.argv[2] || path.join('.looparr', 'next_prompt.txt');
const resolved = path.resolve(target);

let text;
try {
  text = fs.readFileSync(resolved, 'utf8');
} catch (error) {
  console.error(`Cannot read handoff file ${resolved}: ${error.message}`);
  process.exit(1);
}

const result = isMetaPromptHandoff(text);
if (result.poisoned) {
  console.error(`Rejected handoff in ${resolved}: ${result.reason}`);
  process.exit(1);
}

console.log(`Handoff clean: ${resolved}`);
