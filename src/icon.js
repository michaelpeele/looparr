'use strict';

const fs = require('fs');
const path = require('path');

const IMAGE_EXT = new Set(['.svg', '.png', '.ico', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

const CANDIDATES = [
  'public/favicon.svg', 'public/favicon.ico', 'public/favicon.png',
  'public/apple-touch-icon.png', 'public/logo.svg', 'public/icon.svg',
  'src/app/favicon.ico', 'src/app/favicon.png', 'src/app/icon.svg',
  'app/favicon.ico', 'app/favicon.png', 'app/icon.svg', 'app/icon.png',
  'assets/favicon.svg', 'assets/favicon.ico', 'assets/logo.svg',
  'favicon.svg', 'favicon.ico', 'favicon.png',
  'icon.svg', 'icon.png', 'logo.svg'
];

const SCAN_DIRS = ['', 'public', 'public/assets', 'assets', 'app', 'src/app'];

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function mimeType(file) {
  const ext = path.extname(file).toLowerCase();
  const types = {
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.avif': 'image/avif'
  };
  return types[ext] || 'application/octet-stream';
}

function findIcon(projectDir) {
  const root = path.resolve(projectDir);
  for (const candidate of CANDIDATES) {
    const absolute = path.join(root, candidate);
    try {
      if (fs.statSync(absolute).isFile()) return { relativePath: candidate, absolutePath: absolute, mime: mimeType(absolute) };
    } catch { /* keep looking */ }
  }
  const seen = new Set();
  for (const dir of SCAN_DIRS) {
    const directory = path.join(root, dir);
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch { continue; }
    const files = entries
      .filter((entry) => entry.isFile() && IMAGE_EXT.has(path.extname(entry.name).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of files) {
      const absolute = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolute).split(path.sep).join('/');
      if (seen.has(relativePath) || !isInside(root, absolute)) continue;
      seen.add(relativePath);
      return { relativePath, absolutePath: absolute, mime: mimeType(absolute) };
    }
  }
  return null;
}

module.exports = { findIcon, mimeType, isInside };
