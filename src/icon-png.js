'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const PNG_SIZE = 256;
const MAX_SOURCE_BYTES = 128 * 1024;
const CACHE_LIMIT = 32;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const cache = new Map();

function isPng(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function embeddedPngFromIco(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 6) return null;
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) return null;

  const count = buffer.readUInt16LE(4);
  let best = null;
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    if (entry + 16 > buffer.length) break;
    const width = buffer[entry] || 256;
    const height = buffer[entry + 1] || 256;
    const bytes = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    if (bytes < PNG_SIGNATURE.length || offset < 6 || offset + bytes > buffer.length) continue;
    const frame = buffer.subarray(offset, offset + bytes);
    if (!isPng(frame)) continue;
    const score = width * height;
    if (!best || score > best.score) best = { frame, score };
  }
  return best ? best.frame : null;
}

async function readSource(icon) {
  const filePath = icon && (icon.realPath || icon.absolutePath);
  if (!filePath || typeof filePath !== 'string') return null;
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_SOURCE_BYTES) return null;
  try {
    return await fs.promises.readFile(filePath);
  } catch {
    return null;
  }
}

function getCached(key) {
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function setCached(key, value) {
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

async function renderPng(icon) {
  if (!icon) return null;
  const key = `${icon.version || 'raw'}:${icon.realPath || icon.absolutePath || ''}`;
  const cached = getCached(key);
  if (cached) return cached;

  const source = await readSource(icon);
  if (!source) return null;

  const mime = String(icon.mime || '').toLowerCase();
  const ext = path.extname(icon.absolutePath || icon.realPath || '').toLowerCase();
  let input = source;
  if (mime === 'image/x-icon' || ext === '.ico') {
    input = embeddedPngFromIco(source) || source;
  }

  let buffer;
  try {
    buffer = await sharp(input, { density: 144 })
      .resize(PNG_SIZE, PNG_SIZE, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    return null;
  }

  const result = {
    buffer,
    etag: icon.version ? `${icon.version}-png` : 'png'
  };
  setCached(key, result);
  return result;
}

module.exports = { renderPng };
