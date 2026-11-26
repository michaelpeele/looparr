'use strict';

// Paseo run adapter (PLAN-02): converts a Looparr run into a Paseo agent,
// streams its output through the same appendLog/stepOutput path the direct
// spawn uses, waits for the final status, and stops the agent on cancel or
// stale-run cleanup. Enabled only when config.settings.paseoTransport is
// true; never active under the host-executor bridge.

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');
const { paseoProviderForRunner } = require('./runners');
const { sanitizePaseoModelId } = require('./runners/opencode');
const { normalizeOpenCodeSessionId } = require('./runners/opencode-session');

function underHostExecutor() {
  return Boolean(process.env.LOOPARR_EXECUTOR_URL);
}

function isEnabled(settings) {
  if (underHostExecutor()) return false;
  return settings?.paseoTransport === true;
}

// Scan `text` for the first complete JSON object, tolerating surrounding log
// noise (banner lines, progress output). Returns the parsed object or null.
function extractJsonObject(text) {
  const raw = String(text || '');
  try {
    return JSON.parse(raw);
  } catch { /* scan below */ }
  for (let start = raw.indexOf('{'); start !== -1; start = raw.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < raw.length; i += 1) {
      const ch = raw[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(raw.slice(start, i + 1));
          } catch { /* keep scanning */ }
          break;
        }
      }
    }
  }
  return null;
}

// idle -> completed (0); error -> failed (1); permission -> failed (1) with an
// attention note; timeout -> timed out (124, failure).
function mapPaseoStatus(status) {
  switch (String(status || '').toLowerCase()) {
    case 'idle':
      return { code: 0, kind: 'completed' };
    case 'permission':
      return { code: 1, kind: 'permission' };
    case 'timeout':
      return { code: 124, kind: 'timed out' };
    default:
      return { code: 1, kind: 'failed' };
  }
}

const workspaceCache = new Map(); // resolved cwd -> workspace id

// A `paseo run` that rejects the requested model reports it in the JSON error
// (unknown/unavailable/invalid model). Such a run never produced an agent, so
// the caller retries once without the model suffix and lets Paseo pick default.
function isUnknownModelError(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  const parts = [];
  const err = parsed.error;
  if (typeof err === 'string') parts.push(err);
  else if (err && typeof err === 'object') {
    if (err.code) parts.push(String(err.code));
    if (err.message) parts.push(String(err.message));
  }
  if (parsed.message) parts.push(String(parsed.message));
  const text = parts.join(' ');
  return /unknown|unavailable|not\s*found|invalid\s+model|no\s+such\s+model|model\s+[^.]*not\s+(found|available|exist)|does\s+not\s+exist/i.test(text);
}

function paseoOutput(result) {
  return result.status === 0 ? String(result.stdout || '') : '';
}

// One stable workspace per project directory: env override first, then an
// existing workspace whose cwd matches, then a one-time creation. Never a new
// workspace per step; returns '' (no --workspace flag) when unavailable.
function resolveWorkspaceId(cwd) {
  if (process.env.PASEO_WORKSPACE_ID) return String(process.env.PASEO_WORKSPACE_ID);
  const resolved = path.resolve(String(cwd || '.'));
  if (workspaceCache.has(resolved)) return workspaceCache.get(resolved);
  let id = '';
  try {
    const listed = spawnSync('paseo', ['workspace', 'ls', '--json'], { encoding: 'utf8' });
    if (listed.status === 0) {
      const workspaces = extractJsonObject(listed.stdout);
      if (Array.isArray(workspaces)) {
        const match = workspaces.find((entry) => entry && entry.workspaceId
          && path.resolve(String(entry.cwd || '')) === resolved);
        if (match) id = String(match.workspaceId);
      }
    }
    if (!id) {
      const created = spawnSync(
        'paseo',
        ['workspace', 'create', '--json', '--isolation', 'local', '--path', resolved,
          '--title', `looparr ${path.basename(resolved)}`],
        { encoding: 'utf8' }
      );
      if (created.status === 0) {
        const parsed = extractJsonObject(created.stdout) || {};
        if (parsed.workspaceId) id = String(parsed.workspaceId);
      }
    }
  } catch { /* transport unavailable: run without a workspace */ }
  if (id) workspaceCache.set(resolved, id);
  return id;
}

function stopAgent(agentId) {
  const id = String(agentId || '').trim();
  if (!id) return Promise.resolve({ ok: true, stopped: [] });
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('paseo', ['agent', 'stop', id], { env: { ...process.env }, shell: false });
    } catch {
      return resolve({ ok: false, error: 'spawn-failed' });
    }
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.on('error', (error) => finish({ ok: false, error: error.message }));
    child.on('close', (code) => finish({ ok: code === 0, stopped: [id] }));
  });
}

function cleanStaleRuns({ projectId, keepRunKey } = {}) {
  const pid = String(projectId || '').trim();
  if (!pid) return Promise.resolve({ ok: true, cancelled: [] });
  const result = spawnSync('paseo', ['agent', 'ls', '--json', '--label', 'looparr=true'],
    { encoding: 'utf8' });
  if (result.status !== 0) {
    return Promise.resolve({ ok: false, error: String(result.stderr || '').trim() });
  }
  const agents = extractJsonObject(result.stdout);
  let stale = [];
  if (Array.isArray(agents)) {
    stale = agents.filter((entry) => {
      if (!entry || !entry.id) return false;
      const labels = entry.labels || {};
      if (labels.projectId !== pid) return false;
      if (keepRunKey && labels.runKey === keepRunKey) return false;
      return true;
    }).map((entry) => String(entry.id));
  }
  return Promise.all(stale.map((id) => stopAgent(id)))
    .then((results) => ({ ok: true, cancelled: results.filter((item) => item.ok) }));
}

// Shared child-like handle used by both the fresh-run and import/send paths.
// The engine uses it exactly like a spawned CLI process: 'error' and 'close'
// events, .kill() mapped to `paseo agent stop`, .paseoAgentId once the agent is
// known, and .paseoSessionId for the provider session. Output streaming is
// routed through opts.onLog(stream, chunk) so the engine keeps its
// appendLog/stepOutput path.
function createHandle(cwd, onLog) {
  const handle = new EventEmitter();
  handle.paseoArgs = [];
  handle.paseoAgentId = '';
  handle.paseoSessionId = '';
  handle.exitCode = null;
  handle.killed = false;

  let agentId = '';
  let attachChild = null;
  let waitChild = null;
  let runChild = null;
  let sendChild = null;
  let attachGraceTimer = null;
  let closeEmitted = false;
  let pendingKill = false;

  const finishOnce = (code) => {
    if (closeEmitted) return;
    closeEmitted = true;
    handle.exitCode = code;
    handle.emit('close', code);
  };

  const killAttach = () => {
    if (!attachChild) return;
    try { attachChild.kill('SIGKILL'); } catch { /* already gone */ }
  };

  // Wait can resolve before the attach stream has flushed its tail; give the
  // attach a short drain grace so the last output lines still reach the run
  // log, then hard-stop it.
  const finishAfterDrain = (code) => {
    if (!attachChild || closeEmitted
      || attachChild.exitCode !== null || attachChild.signalCode !== null) {
      if (attachGraceTimer) clearTimeout(attachGraceTimer);
      finishOnce(code);
      return;
    }
    if (attachGraceTimer) clearTimeout(attachGraceTimer);
    attachGraceTimer = setTimeout(() => {
      killAttach();
      finishOnce(code);
    }, 500);
    attachChild.once('close', () => {
      if (attachGraceTimer) clearTimeout(attachGraceTimer);
      finishOnce(code);
    });
  };

  const startStreaming = (id) => {
    try {
      attachChild = spawn('paseo', ['attach', id], {
        cwd: String(cwd),
        env: { ...process.env },
        shell: false
      });
    } catch { attachChild = null; }
    if (!attachChild) return;
    attachChild.stdout?.on('data', (chunk) => onLog('out', chunk));
    attachChild.stderr?.on('data', (chunk) => onLog('err', chunk));
    attachChild.on('error', () => { /* timeline unavailable; wait still resolves */ });
  };

  const runWait = (id) => {
    try {
      waitChild = spawn('paseo', ['agent', 'wait', id, '--json'], {
        cwd: String(cwd),
        env: { ...process.env },
        shell: false
      });
    } catch (error) {
      onLog('system', `✖ Paseo wait failed: ${error.message}`);
      return finishOnce(1);
    }
    let output = '';
    waitChild.stdout?.on('data', (chunk) => { output += String(chunk); });
    waitChild.on('error', (error) => {
      if (handle.killed) return;
      onLog('system', `✖ Paseo wait failed: ${error.message}`);
      finishOnce(1);
    });
    waitChild.on('close', (code) => {
      if (handle.killed) return; // cancel path controls the close code
      const parsed = extractJsonObject(output) || {};
      const status = String(parsed.status || '').toLowerCase();
      const mapped = mapPaseoStatus(status);
      if (!status) {
        onLog('system', `✖ Paseo agent ${id} ended without a final status (wait exit ${code}).`);
      }
      if (mapped.kind === 'permission') {
        onLog('system', `⚠ Paseo agent ${id} is waiting for permission: ${parsed.message || 'tool approval needed'}.`);
      } else if (mapped.kind === 'timed out') {
        onLog('system', `✖ Paseo agent ${id} timed out: ${parsed.message || 'wait timed out'}.`);
      } else if (mapped.code !== 0) {
        onLog('system', `✖ Paseo agent ${id} failed: ${parsed.message || status}.`);
      }
      if (attachChild) {
        finishAfterDrain(mapped.code);
      } else {
        finishOnce(mapped.code);
      }
    });
  };

  // Record the agent (and optional provider session) id and emit both events.
  // A started agent can never be orphaned: stop() always has a handle for it.
  handle._agentReady = (id, sessionId) => {
    agentId = String(id || '').trim();
    if (!agentId) return false;
    handle.paseoAgentId = agentId;
    const normalized = normalizeOpenCodeSessionId(sessionId);
    if (normalized) handle.paseoSessionId = normalized;
    handle.emit('agentId', agentId);
    if (normalized) handle.emit('sessionId', normalized);
    return true;
  };
  handle._afterAgent = () => {
    if (pendingKill) {
      stopAgent(agentId);
      return finishOnce(1);
    }
    startStreaming(agentId);
    runWait(agentId);
  };
  handle._startStreaming = startStreaming;
  handle._runWait = runWait;
  handle._finishOnce = finishOnce;
  handle._setRunChild = (child) => { runChild = child; };
  handle._clearRunChild = (child) => { if (runChild === child) runChild = null; };
  handle._setSendChild = (child) => { sendChild = child; };
  handle._clearSendChild = (child) => { if (sendChild === child) sendChild = null; };
  handle._pendingKill = () => pendingKill;

  handle.kill = (signal) => {
    if (handle.killed) return true;
    handle.killed = true;
    if (attachGraceTimer) clearTimeout(attachGraceTimer);
    if (waitChild && waitChild.exitCode === null && waitChild.signalCode === null) {
      try { waitChild.kill('SIGKILL'); } catch { /* already gone */ }
    }
    if (attachChild) {
      try { attachChild.kill('SIGKILL'); } catch { /* already gone */ }
    }
    for (const child of [runChild, sendChild]) {
      if (child && child.exitCode === null && child.signalCode === null) {
        try { child.kill(signal || 'SIGTERM'); } catch { /* already gone */ }
      }
    }
    if (agentId) {
      stopAgent(agentId).then(() => finishOnce(null));
    } else {
      pendingKill = true;
      finishOnce(null);
    }
    return true;
  };

  return handle;
}

// Starts a fresh Paseo agent for one Looparr step. The model id is sanitized to
// the provider's `provider/model` form; a foreign Looparr namespace or an empty
// id omits --model so Paseo selects its default model. If Paseo rejects the
// model as unknown/unavailable, the run is retried once without it.
function spawnRun(opts) {
  const {
    cwd,
    prompt,
    model = '',
    runKey = '',
    projectId = '',
    phase = '',
    task = '',
    title = '',
    runnerId = '',
    workspaceCwd = '',
    onLog = () => {}
  } = opts;
  const handle = createHandle(cwd, onLog);
  const provider = paseoProviderForRunner(runnerId);
  const modelId = sanitizePaseoModelId(model, provider);
  const modelArg = modelId ? `${provider}/${modelId}` : '';
  const agentTitle = (title || `Looparr ${projectId || 'run'} ${phase || ''}${task ? `: ${task}` : ''}`)
    .trim()
    .slice(0, 120);
  const workspaceId = resolveWorkspaceId(workspaceCwd || cwd);

  const buildArgs = (withModel) => {
    const args = ['run', '--no-wait', '--json', '--provider', provider];
    if (withModel && modelArg) args.push('--model', modelArg);
    args.push(
      '--cwd', String(cwd),
      '--title', agentTitle,
      '--label', 'looparr=true',
      '--label', `runner=${runnerId}`,
      '--label', `runKey=${runKey}`,
      '--label', `projectId=${projectId}`
    );
    if (workspaceId) args.push('--workspace', workspaceId);
    args.push(String(prompt)); // prompt is always the final argument
    return args;
  };

  let retried = false;
  const startRun = (args) => {
    handle.paseoArgs = args;
    let output = '';
    let child;
    try {
      child = spawn('paseo', args, { cwd: String(cwd), env: { ...process.env }, shell: false });
    } catch (error) {
      onLog('system', `✖ Paseo run failed: ${error.message}`);
      handle.emit('error', error);
      return handle._finishOnce(1);
    }
    handle._setRunChild(child);
    child.stdout?.on('data', (chunk) => {
      output += String(chunk);
      onLog('out', chunk);
    });
    child.stderr?.on('data', (chunk) => onLog('err', chunk));
    child.on('error', (error) => {
      onLog('system', `✖ Paseo run failed: ${error.message}`);
      handle.emit('error', error);
      handle._finishOnce(1);
    });
    child.on('close', (code) => {
      handle._clearRunChild(child);
      const parsed = extractJsonObject(output) || {};
      const id = String(parsed.agentId || parsed.id || '').trim();
      if (!id) {
        if (!retried && modelArg && isUnknownModelError(parsed)) {
          retried = true;
          onLog('system', `… Paseo rejected model ${modelArg}; retrying with the default model.`);
          return startRun(buildArgs(false));
        }
        if (code !== 0) onLog('system', `✖ Paseo run did not start (exit ${code}).`);
        else onLog('system', '✖ Paseo run returned no agent id.');
        return handle._finishOnce(1);
      }
      if (!handle._agentReady(id, parsed.sessionId || parsed.sessionID || parsed.providerSessionId)) {
        return handle._finishOnce(1);
      }
      handle._afterAgent();
    });
  };

  startRun(buildArgs(true));
  return handle;
}

// Resumes an existing provider session through Paseo: import the OpenCode
// session as a Paseo agent, then send the prompt to it. Reuses the same
// attach/wait/status/kill machinery as spawnRun.
function resumeRun(opts) {
  const {
    cwd,
    prompt,
    sessionId,
    runKey = '',
    projectId = '',
    runnerId = '',
    onLog = () => {}
  } = opts;
  const handle = createHandle(cwd, onLog);
  const provider = paseoProviderForRunner(runnerId);
  const importArgs = [
    'import', String(sessionId),
    '--provider', provider,
    '--cwd', String(cwd),
    '--label', 'looparr=true',
    '--label', `runner=${runnerId}`,
    '--label', `runKey=${runKey}`,
    '--label', `projectId=${projectId}`,
    '--json'
  ];
  handle.paseoArgs = importArgs;

  let output = '';
  let child;
  try {
    child = spawn('paseo', importArgs, { cwd: String(cwd), env: { ...process.env }, shell: false });
  } catch (error) {
    onLog('system', `✖ Paseo import failed: ${error.message}`);
    handle.emit('error', error);
    return handle._finishOnce(1);
  }
  handle._setRunChild(child);
  child.stdout?.on('data', (chunk) => {
    output += String(chunk);
    onLog('out', chunk);
  });
  child.stderr?.on('data', (chunk) => onLog('err', chunk));
  child.on('error', (error) => {
    onLog('system', `✖ Paseo import failed: ${error.message}`);
    handle.emit('error', error);
    handle._finishOnce(1);
  });
  child.on('close', (code) => {
    handle._clearRunChild(child);
    const parsed = extractJsonObject(output) || {};
    const agentId = String(parsed.agentId || parsed.id || '').trim();
    if (!agentId) {
      onLog('system', `✖ Paseo import did not return an agent id (exit ${code}).`);
      return handle._finishOnce(1);
    }
    const providerSessionId = parsed.sessionId || parsed.sessionID
      || parsed.providerSessionId || parsed.providerHandleId || sessionId;
    if (!handle._agentReady(agentId, providerSessionId)) return handle._finishOnce(1);
    if (handle.killed || handle._pendingKill()) {
      stopAgent(agentId);
      return handle._finishOnce(1);
    }
    // Stream the imported session while the prompt is delivered.
    handle._startStreaming(agentId);
    const sendArgs = ['send', agentId, String(prompt), '--no-wait', '--json'];
    let sendChild;
    try {
      sendChild = spawn('paseo', sendArgs, { cwd: String(cwd), env: { ...process.env }, shell: false });
    } catch (error) {
      onLog('system', `✖ Paseo send failed: ${error.message}`);
      return handle._finishOnce(1);
    }
    handle._setSendChild(sendChild);
    sendChild.stdout?.on('data', (chunk) => onLog('out', chunk));
    sendChild.stderr?.on('data', (chunk) => onLog('err', chunk));
    sendChild.on('error', (error) => {
      onLog('system', `✖ Paseo send failed: ${error.message}`);
      handle._finishOnce(1);
    });
    sendChild.on('close', (sendCode) => {
      handle._clearSendChild(sendChild);
      if (handle.killed) return;
      if (sendCode !== 0) {
        onLog('system', `✖ Paseo send failed (exit ${sendCode}).`);
        return handle._finishOnce(1);
      }
      handle._runWait(agentId);
    });
  });

  return handle;
}

module.exports = {
  isEnabled,
  mapPaseoStatus,
  extractJsonObject,
  resolveWorkspaceId,
  spawnRun,
  resumeRun,
  stopAgent,
  cleanStaleRuns
};
