#!/usr/bin/env node
'use strict';

// Human-gated host/dev helper: mark a reviewed healer fix as "accounted" on the
// prod self-heal pill. The fix must already be applied to the current checkout
// (patch-equivalent via `git cherry`, or an ancestor of HEAD). This never merges,
// spawns, restarts, or pushes, and never writes state "healed": an accounted
// record is refused by the merge path and never enables the merge button.
//
// Usage:
//   node scripts/selfheal-account.js --project <projectId|name> [--branch <branch>] --confirm
//
// Prod stays view-only; every status write goes through selfhealStatus.writeStatus.

const path = require('path');
const { spawnSync } = require('child_process');

const selfhealStatus = require(path.join(__dirname, '..', 'src', 'selfheal-status.js'));

const REPO_ROOT = process.env.LOOPARR_REPO_ROOT
  ? path.resolve(process.env.LOOPARR_REPO_ROOT)
  : path.resolve(__dirname, '..');

function usage() {
  return 'Usage: node scripts/selfheal-account.js --project <projectId|name> [--branch <branch>] --confirm';
}

function parseArgs(argv) {
  const out = { project: '', branch: '', confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--confirm') out.confirm = true;
    else if (arg === '--project') out.project = argv[++i] || '';
    else if (arg === '--branch') out.branch = argv[++i] || '';
    else return { error: `Unknown argument: ${arg}` };
  }
  return out;
}

function git(args) {
  return spawnSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });
}

// True when the branch's fix is already in the current checkout: either its head
// is an ancestor of HEAD, or every commit `git cherry` reports is applied (`-`).
function isFixApplied(branch) {
  const head = git(['rev-parse', '--verify', `${branch}^{commit}`]);
  if (head.status !== 0) return false;
  const headSha = head.stdout.trim();
  if (!headSha) return false;

  const ancestor = git(['merge-base', '--is-ancestor', headSha, 'HEAD']);
  if (ancestor.status === 0) return true;

  const cherry = git(['cherry', 'HEAD', branch]);
  if (cherry.status !== 0) return false;
  const lines = cherry.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  return lines.every((line) => line.startsWith('-'));
}

function resolveProjectId(project) {
  if (selfhealStatus.isValidProjectId(project)) return project;
  // Accept a project name, resolved against config; the status filename stays
  // the validated project id.
  try {
    const configStore = require(path.join(__dirname, '..', 'src', 'config.js'));
    const config = configStore.loadConfig();
    const match = (config.projects || []).find((candidate) => candidate.name === project);
    if (match && selfhealStatus.isValidProjectId(match.id)) return match.id;
  } catch { /* fall through to refusal */ }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error || !args.project || !args.confirm) {
    console.error(args.error ? `${args.error}\n${usage()}` : usage());
    process.exit(2);
  }

  const projectId = resolveProjectId(args.project);
  if (!projectId || !selfhealStatus.isValidProjectId(projectId)) {
    console.error(`Refusing: invalid project id "${args.project}"`);
    process.exit(1);
  }
  if (!selfhealStatus.statusFile(REPO_ROOT, projectId)) {
    console.error(`Refusing: status path containment failed for "${projectId}"`);
    process.exit(1);
  }

  const existing = selfhealStatus.readStatus(REPO_ROOT, projectId);
  let branch = args.branch || (existing && existing.branch) || '';
  if (!selfhealStatus.BRANCH_RE.test(branch)) {
    console.error(`Refusing: branch "${branch}" does not match ${selfhealStatus.BRANCH_RE}`);
    process.exit(1);
  }

  if (!isFixApplied(branch)) {
    console.error(`Refusing: fix on branch "${branch}" is not applied to the current checkout`);
    process.exit(1);
  }

  const record = {
    version: selfhealStatus.VERSION,
    projectId,
    projectName: existing ? existing.projectName || '' : '',
    state: 'accounted',
    round: existing ? existing.round || 0 : 0,
    cycles: existing ? existing.cycles || 0 : 0,
    branch,
    phase: 'accounted',
    errorAt: '',
    mergedAt: null,
    analysisFile: '',
    exitCode: null,
    hostname: process.env.HOSTNAME || ''
  };

  const wrote = selfhealStatus.writeStatus(REPO_ROOT, record);
  if (!wrote) {
    console.error('Refusing: failed to write accounted status');
    process.exit(1);
  }
  console.log(`Accounted ${projectId} (${branch}) as fix already applied to the current checkout.`);
}

main();