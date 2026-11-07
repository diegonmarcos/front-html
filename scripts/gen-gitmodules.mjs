#!/usr/bin/env node
// Generate .gitmodules from html-repos.json (the declared html-repo list) and guard that nothing drifts.
//
//   node scripts/gen-gitmodules.mjs            rewrite .gitmodules
//   node scripts/gen-gitmodules.mjs --check    write nothing; exit 1 when .gitmodules differs from the declaration, a declared
//                                              repo has no gitlink in the index, or a gitlink/submodule is not declared
//
// New repo: add its name to html-repos.json, run this script, then pin the gitlink:
//   git update-index --add --cacheinfo 160000,$(git ls-remote <url> HEAD | cut -f1),<path>
// (a gitlink is committed by hand: the site's ship engine never stages submodules).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const decl = JSON.parse(readFileSync(join(ROOT, 'html-repos.json'), 'utf8'));
const entries = [...decl.base, ...decl.repos.map((r) => ({ path: r, repo: r }))];

const dup = entries.map((e) => e.path).filter((p, i, a) => a.indexOf(p) !== i);
if (dup.length) { console.error(`html-repos.json: duplicate path ${dup.join(', ')}`); process.exit(1); }

const text = [
  '# GENERATED FILE: DO NOT EDIT. `node scripts/gen-gitmodules.mjs` derives it from html-repos.json.',
  '# Guard: `node scripts/gen-gitmodules.mjs --check` (CI: pages-drift).',
  '',
  ...entries.map((e) => `[submodule "${e.path}"]\n\tpath = ${e.path}\n\turl = https://github.com/${decl.owner}/${e.repo}.git\n\tbranch = ${decl.branch}\n`),
].join('\n');

const file = join(ROOT, '.gitmodules');
if (!process.argv.includes('--check')) {
  writeFileSync(file, text);
  console.log(`wrote .gitmodules (${entries.length} submodules)`);
  process.exit(0);
}
let bad = 0;
if ((existsSync(file) ? readFileSync(file, 'utf8') : '') !== text) { console.error('.gitmodules differs from html-repos.json: run node scripts/gen-gitmodules.mjs'); bad = 1; }
const links = new Set(execFileSync('git', ['-C', ROOT, 'ls-files', '--stage'], { encoding: 'utf8' })
  .split('\n').filter((l) => l.startsWith('160000')).map((l) => l.split('\t')[1]));
for (const e of entries) if (!links.has(e.path)) { console.error(`declared html repo ${e.repo} has no gitlink at ${e.path}`); bad = 1; }
for (const p of links) if (!entries.some((e) => e.path === p)) { console.error(`gitlink ${p} is not a declared html repo`); bad = 1; }
if (!bad) console.log(`submodules match html-repos.json (${entries.length})`);
process.exit(bad);
