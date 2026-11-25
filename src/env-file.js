'use strict';

const fs = require('fs');

// Minimal .env reader. Existing process.env values always win, so a real
// environment (container env_file, shell exports) is never clobbered. When
// `keys` is given only those keys are loaded; this keeps a partial load from
// flipping unrelated runtime flags (for example LOOPARR_EXECUTOR_URL).
function loadDotEnv(file, options = {}) {
  if (!fs.existsSync(file)) return;
  const keys = Array.isArray(options.keys) && options.keys.length ? new Set(options.keys) : null;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (keys && !keys.has(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

module.exports = { loadDotEnv };