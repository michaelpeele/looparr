'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const DEFAULT_SETTINGS = {
  maxConcurrent: 2,
  mode: 'parallel',
  globalRunner: 'opencode',
  rateLimitPauseSeconds: 60
};

function defaults() {
  return { settings: { ...DEFAULT_SETTINGS }, projects: [] };
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return defaults();
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
      projects: Array.isArray(raw.projects) ? raw.projects : []
    };
  } catch (error) {
    console.error(`[looparr] Could not read config.json: ${error.message}`);
    return defaults();
  }
}

function saveConfig(config) {
  const temp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, CONFIG_PATH);
}

module.exports = { CONFIG_PATH, DEFAULT_SETTINGS, defaults, loadConfig, saveConfig };
