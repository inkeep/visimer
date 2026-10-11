#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUBTREE = 'Visimer';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LOCKFILE = 'pnpm-lock.yaml';
const INSTALLED_LOCKFILE = 'node_modules/.pnpm/lock.yaml';
const INSTALL = `\`pnpm install\` in ${ROOT}`;

function readIfPresent(path) {
  try {
    return { bytes: readFileSync(join(ROOT, path)) };
  } catch (e) {
    if (e.code === 'ENOENT') return { bytes: null };
    return { problem: { state: 'unreadable', path, code: e.code } };
  }
}

function installProblem() {
  if (!existsSync(join(ROOT, 'node_modules'))) return { state: 'not installed', why: 'node_modules is missing' };
  const wanted = readIfPresent(LOCKFILE);
  if (wanted.problem) return wanted.problem;
  if (wanted.bytes === null) return null;
  const installed = readIfPresent(INSTALLED_LOCKFILE);
  if (installed.problem) return installed.problem;
  if (installed.bytes === null) return { state: 'stale', why: `${INSTALLED_LOCKFILE} is missing` };
  return wanted.bytes.equals(installed.bytes) ? null : { state: 'stale', why: `${INSTALLED_LOCKFILE} differs from ${LOCKFILE}` };
}

function refusalLines(problem) {
  if (problem.state === 'unreadable') {
    const fix =
      problem.path === LOCKFILE
        ? `make ${LOCKFILE} readable`
        : `make node_modules readable (chmod -R u+rwX ${ROOT}/node_modules), or remove node_modules and run ${INSTALL}`;
    return [
      `check:agent (${SUBTREE}): its install could not be read (${problem.path}: ${problem.code}), so whether its dependencies match its lockfile cannot be told. Fix it: ${fix}, then re-run.`,
      `NOT-RUN: check:agent (${SUBTREE}) (${problem.path} could not be read: ${problem.code}; ${fix}, then re-run)`
    ];
  }
  const consequence =
    problem.state === 'stale'
      ? 'so the round would run against dependencies its lockfile does not name'
      : 'so the round cannot run';
  return [
    `check:agent (${SUBTREE}): its dependencies are ${problem.state} (${problem.why}), ${consequence}. Install them with ${INSTALL}, then re-run.`,
    `NOT-RUN: check:agent (${SUBTREE}) (its dependencies are ${problem.state}: ${problem.why}; install them with ${INSTALL}, then re-run)`
  ];
}

function refuse(message, status) {
  console.error(`check:agent (${SUBTREE}): ${message}`);
  process.exit(status);
}

const [script, ...rest] = process.argv.slice(2);
if (!script || script.startsWith('-')) {
  refuse(
    'the manifest must name the script this round runs, as `node scripts/check-agent.mjs <script>`',
    2
  );
}
let base = null;
let all = false;
let because = null;
for (const arg of rest) {
  if (arg === '--') continue;
  if (arg === '--all') all = true;
  else if (arg.startsWith('--all-because='))
    because = arg.slice('--all-because='.length).trim() || null;
  else if (arg.startsWith('--base=')) base = arg.slice('--base='.length).trim() || null;
  else {
    refuse(
      `unrecognized argument '${arg}'. This round accepts --base=<commit>, --all and --all-because=<reason>, or GATE_BASE_SHA, and runs the whole subtree whichever it is given.`,
      2
    );
  }
}
const comparison = base ?? ((process.env.GATE_BASE_SHA || '').trim() || null);

const problem = installProblem();
if (problem) {
  for (const line of refusalLines(problem)) console.error(line);
  process.exit(77);
}

const widened = all
  ? `; --all${because ? ` (${because})` : ''} changes nothing, since nothing is narrowed`
  : '';
console.log(
  `check:agent (${SUBTREE}): runs \`pnpm run ${script}\` over the whole subtree; the comparison ${comparison ?? '(none given)'} does not narrow it${widened}.`
);
const result = spawnSync('pnpm', ['run', script], { cwd: ROOT, stdio: 'inherit' });
if (result.error) refuse(`pnpm could not be started: ${result.error.message}`, 1);
if (result.signal)
  refuse(
    `\`pnpm run ${script}\` was killed by signal ${result.signal}`,
    128 + constants.signals[result.signal]
  );
process.exit(result.status ?? 1);
