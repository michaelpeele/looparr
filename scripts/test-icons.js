#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const iconLib = require(path.join(REPO_ROOT, 'src', 'icon'));
const configStore = require(path.join(REPO_ROOT, 'src', 'config'));
const TMP_ROOT = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-icons-'));

function mkdirp(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeFile(relative, content) {
  const target = path.join(TMP_ROOT, relative);
  mkdirp(path.dirname(target));
  fs.writeFileSync(target, content);
}

function fresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function httpGet(port, requestPath) {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: requestPath }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    request.on('error', () => resolve(null));
  });
}

async function waitForServer(port, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited early (${child.exitCode})`);
    const response = await httpGet(port, '/api/state');
    if (response) return;
    await delay(100);
  }
  throw new Error('Server did not become ready');
}

function serverChild(mode) {
  const enginePath = path.join(REPO_ROOT, 'src', 'engine');
  const serverPath = path.join(REPO_ROOT, 'server');
  const script = [
    `const engine = require(${JSON.stringify(enginePath)});`,
    `const projectDir = ${JSON.stringify(path.join(TMP_ROOT, 'server-project'))};`,
    `if (${JSON.stringify(mode)} === 'escape') {`,
    `  engine.getIcon = () => ({`,
    `    absolutePath: require('path').join(projectDir, 'escape.png'),`,
    `    relativePath: 'escape.png',`,
    `    mime: 'image/png',`,
    `    version: 'escape123456'`,
    `  });`,
    `} else {`,
    `  engine.getIcon = () => ({`,
    `    absolutePath: require('path').join(projectDir, 'public', 'app-icon.svg'),`,
    `    relativePath: 'public/app-icon.svg',`,
    `    mime: 'image/svg+xml',`,
    `    version: 'abc123def456'`,
    `  });`,
    `}`,
    `require(${JSON.stringify(serverPath)});`
  ].join('\n');
  return script;
}

async function requestIconRoute(mode, configPath) {
  const port = await freePort();
  const child = spawn(process.execPath, ['-e', serverChild(mode)], {
    cwd: REPO_ROOT,
    env: { ...process.env, CONFIG_PATH: configPath, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    await waitForServer(port, child);
    const response = await httpGet(port, '/api/projects/iconserver/icon');
    if (!response) throw new Error(`No icon response (${mode}): ${stderr}`);
    return response;
  } finally {
    child.kill('SIGKILL');
  }
}

async function main() {
  const conventional = path.join(TMP_ROOT, 'conventional');
  writeFile('conventional/index.html', '<link rel="icon" href="/assets/custom.png">');
  writeFile('conventional/assets/custom.png', 'custom');
  writeFile('conventional/public/logo.svg', '<svg></svg>');
  writeFile('conventional/public/favicon.ico', 'ICO');
  const conventionalIcon = iconLib.findIcon(conventional);
  assert(conventionalIcon, 'conventional project should have an icon');
  assert.strictEqual(conventionalIcon.relativePath, 'public/favicon.ico');

  const declared = path.join(TMP_ROOT, 'declared');
  writeFile('declared/index.html', '<LINK REL="ICON" HREF=/assets/custom.svg?v=2>');
  writeFile('declared/assets/custom.svg', '<svg></svg>');
  writeFile('declared/public/logo.svg', '<svg></svg>');
  const declaredIcon = iconLib.findIcon(declared);
  assert(declaredIcon, 'HTML-declared icon should be found');
  assert.strictEqual(declaredIcon.relativePath, 'assets/custom.svg');

  const manifest = path.join(TMP_ROOT, 'manifest');
  writeFile('manifest/index.html', '<link rel="manifest" href="./manifest.webmanifest">');
  writeFile('manifest/manifest.webmanifest', JSON.stringify({
    name: 'Demo',
    icons: [
      { src: './icons/app.png', sizes: '192x192', type: 'image/png' },
      { src: './icons/app.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
    ]
  }));
  writeFile('manifest/icons/app.png', 'PNG');
  writeFile('manifest/icons/app.svg', '<svg></svg>');
  const manifestIcon = iconLib.findIcon(manifest);
  assert(manifestIcon, 'manifest icon should be found');
  assert.strictEqual(manifestIcon.relativePath, 'icons/app.svg');

  const rejected = path.join(TMP_ROOT, 'rejected');
  writeFile('outside-secret.png', 'OUTSIDE');
  writeFile('rejected/index.html', [
    '<link rel="icon" href="http://example.com/icon.png">',
    '<link rel="icon" href="https://example.com/icon.png">',
    '<link rel="icon" href="//example.com/icon.png">',
    '<link rel="icon" href="data:image/png;base64,AAAA">',
    '<link rel="icon" href="javascript:alert(1)">',
    '<link rel="icon" href="file:///etc/passwd">',
    '<link rel="icon" href="/etc/passwd">',
    '<link rel="icon" href="../outside-secret.png">',
    '<link rel="icon" href="assets/escaped.png">'
  ].join('\n'));
  mkdirp(path.join(rejected, 'assets'));
  fs.symlinkSync(path.join(TMP_ROOT, 'outside-secret.png'), path.join(rejected, 'assets', 'escaped.png'));
  assert.strictEqual(iconLib.findIcon(rejected), null, 'remote and escaping icons must be ignored');

  const unreadable = path.join(TMP_ROOT, 'unreadable');
  writeFile('unreadable/public', 'not a directory');
  mkdirp(path.join(unreadable, 'assets'));
  fs.symlinkSync(path.join(TMP_ROOT, 'does-not-exist.svg'), path.join(unreadable, 'assets', 'broken.svg'));
  assert.strictEqual(iconLib.findIcon(unreadable), null, 'unreadable and broken paths must be skipped');

  const versionProject = path.join(TMP_ROOT, 'versioned');
  writeFile('versioned/favicon.svg', '<svg id="first"></svg>');
  const savedConfigPath = process.env.CONFIG_PATH;
  const engineConfigPath = path.join(TMP_ROOT, 'engine-config.json');
  fs.writeFileSync(engineConfigPath, JSON.stringify({
    settings: configStore.DEFAULT_SETTINGS,
    projects: []
  }));
  process.env.CONFIG_PATH = engineConfigPath;
  delete require.cache[require.resolve(path.join(REPO_ROOT, 'src', 'config'))];
  const engine = fresh(path.join(REPO_ROOT, 'src', 'engine'));
  try {
    const icon = { absolutePath: path.join(versionProject, 'favicon.svg') };
    const firstVersion = engine.iconVersionFor(icon);
    writeFile('versioned/favicon.svg', '<svg id="second"></svg>');
    const secondVersion = engine.iconVersionFor(icon);
    assert(firstVersion && secondVersion, 'iconVersionFor must return a version');
    assert.notStrictEqual(firstVersion, secondVersion, 'same-path byte change must change iconVersion');
  } finally {
    if (savedConfigPath === undefined) delete process.env.CONFIG_PATH;
    else process.env.CONFIG_PATH = savedConfigPath;
  }

  const serverProject = path.join(TMP_ROOT, 'server-project');
  writeFile('server-project/public/app-icon.svg', '<svg></svg>');
  fs.symlinkSync(path.join(TMP_ROOT, 'outside-secret.png'), path.join(serverProject, 'escape.png'));
  const serverConfigPath = path.join(TMP_ROOT, 'server-config.json');
  fs.writeFileSync(serverConfigPath, JSON.stringify({
    settings: configStore.DEFAULT_SETTINGS,
    projects: [configStore.normalizeProject({
      id: 'iconserver',
      name: 'Icon Server',
      path: serverProject,
      runner: 'opencode'
    })]
  }));

  const escapeResponse = await requestIconRoute('escape', serverConfigPath);
  assert.strictEqual(escapeResponse.statusCode, 400);
  assert.match(escapeResponse.body, /Invalid icon path/);
  assert(!escapeResponse.body.includes(TMP_ROOT), 'error body must not expose absolute paths');

  const validResponse = await requestIconRoute('valid', serverConfigPath);
  assert.strictEqual(validResponse.statusCode, 200);
  assert.strictEqual(validResponse.headers['content-type'], 'image/svg+xml');
  assert.strictEqual(validResponse.headers['x-content-type-options'], 'nosniff');
  assert.match(validResponse.headers['content-security-policy'] || '', /default-src 'none'/);
  assert.strictEqual(validResponse.headers['cache-control'], 'no-cache');
  assert.strictEqual(validResponse.headers.etag, '"abc123def456"');

  console.log('icon discovery and serving tests passed');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});
