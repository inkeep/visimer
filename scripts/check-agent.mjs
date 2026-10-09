#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUBTREE = 'Visimer';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const INSTALLED = 'node_modules/.modules.yaml';
const INSTALL = `\`pnpm install\` in ${ROOT}`;

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

if (!existsSync(join(ROOT, INSTALLED))) {
  console.error(
    `check:agent (${SUBTREE}): its dependencies are not installed (${INSTALLED} is missing), so the round cannot run. Install them with ${INSTALL}, then re-run.`
  );
  console.error(
    `NOT-RUN: check:agent (${SUBTREE}) (its dependencies are not installed: ${INSTALLED} is missing; install them with ${INSTALL}, then re-run)`
  );
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
