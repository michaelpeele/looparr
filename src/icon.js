'use strict';

const fs = require('fs');
const path = require('path');

const IMAGE_EXT = new Set(['.svg', '.png', '.ico', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
const MAX_ICON_FILE_BYTES = 128 * 1024;

const CONVENTIONAL_CANDIDATES = [
  'public/favicon.svg', 'public/favicon.ico', 'public/favicon.png',
  'src/app/favicon.ico', 'src/app/favicon.png',
  'app/favicon.ico', 'app/favicon.png',
  'assets/favicon.svg', 'assets/favicon.ico',
  'favicon.svg', 'favicon.ico', 'favicon.png'
];

const GENERIC_CANDIDATES = [
  'public/apple-touch-icon.png', 'public/logo.svg', 'public/icon.svg',
  'src/app/icon.svg',
  'app/icon.svg', 'app/icon.png',
  'assets/logo.svg',
  'icon.svg', 'icon.png', 'logo.svg'
];

const HTML_FILES = [
  'index.html', 'public/index.html', 'src/app/index.html', 'app/index.html', 'dist/index.html'
];

const SCAN_DIRS = ['', 'public', 'public/assets', 'assets', 'app', 'src/app'];
const LINK_TAG_RE = /<link\b[^>]*>/gi;

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

function normalizeRelative(value) {
  let text = String(value || '').trim();
  if (!text || text.includes('\0') || text.includes('\\')) return null;
  if (path.posix.isAbsolute(text) || path.isAbsolute(text) || /^[a-z][a-z\d+.-]*:/i.test(text)) return null;
  text = path.posix.normalize(text).replace(/^\.\//, '');
  if (!text || text === '.' || text === '..' || text.startsWith('../')) return null;
  return text;
}

function relativeDir(relativePath) {
  const normalized = normalizeRelative(relativePath);
  if (!normalized) return '';
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

function cleanHref(raw) {
  let value = String(raw || '').trim();
  if (!value) return null;
  try { value = decodeURIComponent(value); } catch { /* keep raw value */ }
  if (value.startsWith('//')) return null;
  const boundary = value.search(/[?#]/);
  if (boundary >= 0) value = value.slice(0, boundary);
  return normalizeRelative(value.replace(/^\/+/, ''));
}

function hrefRelative(href, baseDir) {
  const cleaned = cleanHref(href);
  if (!cleaned) return null;
  if (String(href || '').trim().startsWith('/')) return cleaned;
  return normalizeRelative(path.posix.join(baseDir || '', cleaned));
}

function resolveFile(root, rootReal, relativePath) {
  const normalized = normalizeRelative(relativePath);
  if (!normalized) return null;
  const absolute = path.resolve(root, normalized);
  if (!isInside(root, absolute)) return null;
  let real;
  try { real = fs.realpathSync(absolute); } catch { return null; }
  if (!isInside(rootReal, real)) return null;
  let stat;
  try { stat = fs.statSync(real); } catch { return null; }
  if (!stat.isFile()) return null;
  return { relativePath: normalized, absolutePath: absolute, realPath: real };
}

function readSmallFile(absolutePath) {
  try {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile() || stat.size > MAX_ICON_FILE_BYTES) return null;
    return fs.readFileSync(absolutePath, 'utf8');
  } catch {
    return null;
  }
}

function seenKeys(resolved) {
  return [`rel:${resolved.relativePath}`, `real:${resolved.realPath}`];
}

function isSeen(resolved, seen) {
  return seenKeys(resolved).some((key) => seen.has(key));
}

function markSeen(resolved, seen) {
  for (const key of seenKeys(resolved)) seen.add(key);
}

function imageFromRelative(root, rootReal, relativePath, seen) {
  const resolved = resolveFile(root, rootReal, relativePath);
  if (!resolved || !IMAGE_EXT.has(path.extname(resolved.realPath).toLowerCase())) return null;
  if (isSeen(resolved, seen)) return null;
  markSeen(resolved, seen);
  return {
    relativePath: resolved.relativePath,
    absolutePath: resolved.realPath,
    mime: mimeType(resolved.realPath)
  };
}

function attributeValue(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  if (!match) return '';
  return match[1] !== undefined ? match[1] : (match[2] !== undefined ? match[2] : (match[3] || ''));
}

function extRank(src) {
  const ext = path.extname(src).toLowerCase();
  if (ext === '.svg') return 0;
  if (ext === '.png') return 1;
  return 2;
}

function purposeRank(icon) {
  const purposes = String(icon && icon.purpose || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!purposes.length || purposes.includes('any')) return 0;
  if (purposes.includes('maskable')) return 1;
  return 2;
}

function manifestIcons(data) {
  if (!data || !Array.isArray(data.icons)) return [];
  return data.icons
    .map((icon, index) => ({ src: icon && icon.src, index, rank: purposeRank(icon) }))
    .filter((icon) => typeof icon.src === 'string' && icon.src.trim())
    .sort((a, b) => extRank(a.src) - extRank(b.src) || a.rank - b.rank || a.index - b.index);
}

function discoverDeclared(root, rootReal, seen) {
  const direct = [];
  const manifests = [];
  for (const htmlRel of HTML_FILES) {
    const htmlFile = resolveFile(root, rootReal, htmlRel);
    if (!htmlFile) continue;
    const html = readSmallFile(htmlFile.realPath);
    if (!html) continue;
    const baseDir = relativeDir(htmlRel);
    const tags = html.match(LINK_TAG_RE) || [];
    for (const tag of tags) {
      const rel = attributeValue(tag, 'rel').toLowerCase().split(/\s+/).filter(Boolean);
      const href = attributeValue(tag, 'href');
      if (!href) continue;
      if (rel.includes('manifest')) {
        const manifestRelative = hrefRelative(href, baseDir);
        const manifestFile = manifestRelative && resolveFile(root, rootReal, manifestRelative);
        if (manifestFile) {
          manifests.push({ resolved: manifestFile, baseDir: relativeDir(manifestFile.relativePath) });
        }
        continue;
      }
      if (!rel.includes('icon') && !rel.includes('apple-touch-icon')) continue;
      const relative = hrefRelative(href, baseDir);
      if (!relative) continue;
      const found = imageFromRelative(root, rootReal, relative, seen);
      if (found) direct.push(found);
    }
  }
  for (const manifest of manifests) {
    const text = readSmallFile(manifest.resolved.realPath);
    if (!text) continue;
    let data;
    try { data = JSON.parse(text); } catch { continue; }
    for (const icon of manifestIcons(data)) {
      const relative = hrefRelative(icon.src, manifest.baseDir);
      if (!relative) continue;
      const found = imageFromRelative(root, rootReal, relative, seen);
      if (found) direct.push(found);
    }
  }
  return direct;
}

function findIcon(projectDir) {
  try {
    const root = path.resolve(projectDir);
    let rootReal = root;
    try { rootReal = fs.realpathSync(root); } catch { /* keep lexical root */ }
    const seen = new Set();

    for (const candidate of CONVENTIONAL_CANDIDATES) {
      const found = imageFromRelative(root, rootReal, candidate, seen);
      if (found) return found;
    }
    for (const found of discoverDeclared(root, rootReal, seen)) return found;
    for (const candidate of GENERIC_CANDIDATES) {
      const found = imageFromRelative(root, rootReal, candidate, seen);
      if (found) return found;
    }

    for (const dir of SCAN_DIRS) {
      const directory = path.join(root, dir);
      let entries;
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch { continue; }
      const files = entries
        .filter((entry) => IMAGE_EXT.has(path.extname(entry.name).toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of files) {
        const relativePath = path.relative(root, path.join(directory, entry.name)).split(path.sep).join('/');
        const found = imageFromRelative(root, rootReal, relativePath, seen);
        if (found) return found;
      }
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = { findIcon, mimeType, isInside };
