#!/usr/bin/env node
// Generate pages.json: every PUBLIC repo of the owner that publishes GitHub Pages. Nothing is typed.
//
// Source of truth is the GitHub API, read through the `gh` CLI (env GH overrides the binary, PAGES_OWNER the owner):
//   users/<owner>/repos            -> the owner's public repos, kept when has_pages
//   repos/<owner>/<repo>/pages     -> html_url (the URL), source {branch,path}, build_type, public
//
//   node scripts/gen-pages.mjs            rewrite pages.json
//   node scripts/gen-pages.mjs --check    write nothing; exit 1 when pages.json differs from the API (drift)
//
// The output is deterministic (sorted by repo, no timestamp), so a diff means the API changed.
// Cloud Browser (Favourites > GH Pages) reads this file at runtime from raw.githubusercontent.com.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER = process.env.PAGES_OWNER || 'diegonmarcos';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'pages.json');
const GH = process.env.GH || 'gh';

// gh prints one JSON array per page with --paginate: concatenate the arrays.
function parseConcatenated(out) {
  const rows = [];
  let i = 0;
  while (i < out.length) {
    if (/\s/.test(out[i])) { i++; continue; }
    let depth = 0, inStr = false, esc = false, j = i;
    for (; j < out.length; j++) {
      const c = out[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    rows.push(...JSON.parse(out.slice(i, j)));
    i = j;
  }
  return rows;
}

function api(path, paginate = false) {
  const args = ['api', path, ...(paginate ? ['--paginate'] : [])];
  const out = execFileSync(GH, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
  return paginate ? parseConcatenated(out) : JSON.parse(out);
}

function derive() {
  const pages = [];
  for (const r of api(`users/${OWNER}/repos?per_page=100&type=owner`, true)) {
    if (r.private || !r.has_pages) continue;
    let p;
    try { p = api(`repos/${OWNER}/${r.name}/pages`); }
    catch { continue; } // has_pages but the site is gone or not readable: not a link worth listing
    if (!p.public || !(p.html_url || '').startsWith('https://')) continue;
    const src = p.source || {};
    pages.push({
      repo: r.name, url: p.html_url,
      source: { branch: src.branch ?? null, path: src.path ?? null, build_type: p.build_type ?? null },
      public: true,
    });
  }
  const key = (x) => x.repo.toLowerCase();
  pages.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return { _generated: 'DO NOT EDIT: scripts/gen-pages.py derives this from the GitHub API', owner: OWNER, pages };
}

function main(argv) {
  const text = JSON.stringify(derive(), null, 2) + '\n';
  if (argv.includes('--check')) {
    const have = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (have !== text) {
      process.stderr.write('pages.json drifted from the GitHub API: run node scripts/gen-pages.mjs and commit\n');
      return 1;
    }
    console.log('pages.json up to date');
    return 0;
  }
  writeFileSync(OUT, text);
  console.log(`wrote ${normalize(OUT)}`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
