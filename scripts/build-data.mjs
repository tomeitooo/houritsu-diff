#!/usr/bin/env node
// Builds the static index the site reads, from a clone of Kohei-Wada/houritsu.
// usage: node scripts/build-data.mjs <clone> <output dir>
//
// Only metadata and change counts are written. The diffs themselves are computed in the
// browser from the two revisions of a file, which keeps the output around 30 MB rather
// than the 1 GB a full set of diffs would take.

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import readline from 'node:readline';
import { normalizeLine } from '../site/js/normalize.js';

const REPO = process.argv[2] ?? 'source/houritsu';
const OUT = process.argv[3] ?? 'site/data';
const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });

const hasUpcoming = git('branch', '--list', 'upcoming').trim() !== '';
const TIP = hasUpcoming ? 'upcoming' : 'main';
const upcomingShas = new Set(hasUpcoming ? git('rev-list', 'main..upcoming').split('\n').filter(Boolean) : []);

function lines(args, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', REPO, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', onLine);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git exited ${code}`))));
  });
}

// --- commits and the files each one touches
const commits = [];
{
  let current = null;
  let inBody = false;
  await lines(['log', TIP, '--no-renames', '--name-status', '--format=%x01%H %P%n%B%x02', '--', 'laws'], (line) => {
    if (line.startsWith('\x01')) {
      const [sha, parent] = line.slice(1).split(' ');
      current = { sha, parent: parent ?? '', body: [], files: [] };
      commits.push(current);
      inBody = true;
    } else if (inBody) {
      if (line.endsWith('\x02')) {
        const rest = line.slice(0, -1);
        if (rest) current.body.push(rest);
        inBody = false;
      } else {
        current.body.push(line);
      }
    } else if (line && current) {
      const [kind, path] = line.split('\t');
      if (path?.startsWith('laws/')) current.files.push({ kind, path });
    }
  });
}
console.log(`commits: ${commits.length}`);

// --- statute level change counts for modified files
const FRONTMATTER_LINE = /^(---$|[a-z_]+:|  [a-z_]+:)/;
const FRONTMATTER_MAX_LINE = 40;
const stats = new Map();
{
  let sha = '';
  let path = '';
  let oldLeft = 0;
  let newLeft = 0;
  let oldNo = 0;
  let newNo = 0;
  let dels = [];
  let adds = [];

  const flushHunk = () => {
    if (!dels.length && !adds.length) return;
    const counts = new Map();
    for (const text of dels) counts.set(text, (counts.get(text) ?? 0) + 1);
    let added = 0;
    for (const text of adds) {
      const left = counts.get(text) ?? 0;
      if (left > 0) counts.set(text, left - 1); else added++;
    }
    let removed = 0;
    for (const left of counts.values()) removed += left;
    const key = `${sha}\0${path}`;
    const entry = stats.get(key) ?? [0, 0];
    entry[0] += added;
    entry[1] += removed;
    stats.set(key, entry);
    dels = [];
    adds = [];
  };

  const take = (content, lineNo, into) => {
    if (lineNo <= FRONTMATTER_MAX_LINE && FRONTMATTER_LINE.test(content)) return;
    const normalized = normalizeLine(content);
    if (normalized) into.push(normalized.text);
  };

  await lines(['log', TIP, '--no-renames', '--diff-filter=M', '-p', '-U0', '--minimal', '--no-color', '--no-ext-diff', '--format=%x01%H', '--', 'laws'], (line) => {
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith('-')) { take(line.slice(1), oldNo++, dels); oldLeft--; }
      else if (line.startsWith('+')) { take(line.slice(1), newNo++, adds); newLeft--; }
      return;
    }
    if (line.startsWith('\x01')) { flushHunk(); sha = line.slice(1); return; }
    if (line.startsWith('+++ b/')) { flushHunk(); path = line.slice(6); return; }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      flushHunk();
      oldNo = Number(hunk[1]);
      oldLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      newNo = Number(hunk[3]);
      newLeft = hunk[4] === undefined ? 1 : Number(hunk[4]);
    }
  });
  flushHunk();
}
console.log(`modified files counted: ${stats.size}`);

// --- law metadata
const field = (text, name) => new RegExp(`^${name}: "(.*)"$`, 'm').exec(text)?.[1] ?? '';
function parseLaw(text, path) {
  const end = text.indexOf('\n---\n', 4);
  const head = text.slice(0, end < 0 ? 4000 : end);
  return {
    id: basename(path, '.md'),
    dir: path.split('/')[1],
    title: field(head, 'title'),
    kana: field(head, 'title_kana'),
    abbrev: field(head, 'abbrev'),
    num: field(head, 'law_num'),
    category: field(head, 'category'),
  };
}

const laws = new Map();
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.md')) {
      const relative = full.slice(REPO.length + 1);
      laws.set(basename(entry.name, '.md'), { ...parseLaw(readFileSync(full, 'utf8'), relative), repealed: false });
    }
  }
};
walk(join(REPO, 'laws'));
const activeCount = laws.size;

// --- parse commits into revisions
const parseMessage = (body) => {
  const value = (label) => {
    const prefix = `${label}: `;
    return body.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim() ?? '';
  };
  return {
    title: (body[0] ?? '').replace(/ 施行$/, ''),
    num: value('改正法令'),
    promulgated: value('公布日'),
    enforcedText: value('施行日'),
    amendmentId: value('Amendment-Law-Id'),
    enforced: value('Enforced'),
    bill: value('Bill'),
    submitter: value('Bill-Submitter'),
    billUrl: value('Bill-Url'),
    skipped: body.filter((l) => l.startsWith('Skipped-Revision: ')).length,
  };
};

const revisions = new Map();
const monthly = new Map();
const upcoming = [];
const missing = new Set();
const idOf = (path) => basename(path, '.md');

// Oldest first, so the state of each law is known when it is first seen.
for (let c = commits.length - 1; c >= 0; c--) {
  const commit = commits[c];
  const meta = parseMessage(commit.body);
  const isUpcoming = upcomingShas.has(commit.sha);
  const monthKey = isUpcoming ? 'upcoming' : meta.enforced.slice(0, 7);
  const changed = [];

  for (const { kind, path } of commit.files) {
    const id = idOf(path);
    if (!laws.has(id)) missing.add(`${id}\0${path}\0${kind === 'D' ? commit.parent : commit.sha}`);
    const [added, removed] = kind === 'M' ? stats.get(`${commit.sha}\0${path}`) ?? [0, 0] : [0, 0];
    // A file appearing is an enactment only when the amending law is the law itself.
    // Otherwise it is where e-Gov's revision data for that law begins.
    const enacted = kind === 'A' && meta.amendmentId === id;
    const type = kind === 'A' ? (enacted ? 'N' : 'S') : kind;
    const inFeed = type === 'N' || type === 'D' || (type === 'M' && added + removed > 0);

    const list = revisions.get(id) ?? [];
    list.push({
      s: commit.sha,
      e: meta.enforced,
      p: meta.promulgated,
      t: meta.title,
      n: meta.num,
      a: added,
      d: removed,
      k: type,
      ...(isUpcoming ? { u: 1 } : {}),
      ...(inFeed ? { m: monthKey } : {}),
      path,
    });
    revisions.set(id, list);
    if (inFeed) changed.push([id, added, removed, type]);
  }

  if (!changed.length) continue;
  const entry = {
    s: commit.sha,
    ps: commit.parent,
    e: meta.enforced,
    ...(meta.enforced === 'undetermined' ? { et: meta.enforcedText } : {}),
    p: meta.promulgated,
    t: meta.title,
    n: meta.num,
    ...(meta.bill ? { b: meta.bill, bs: meta.submitter, bu: meta.billUrl } : {}),
    ...(meta.skipped ? { sk: meta.skipped } : {}),
    f: changed,
  };
  if (isUpcoming) upcoming.push(entry);
  else {
    const list = monthly.get(monthKey) ?? [];
    list.push(entry);
    monthly.set(monthKey, list);
  }
}

// Laws no longer in the main tree: read their last known revision from history.
for (const item of missing) {
  const [id, path, sha] = item.split('\0');
  if (laws.has(id)) continue;
  const text = git('show', `${sha}:${path}`);
  laws.set(id, { ...parseLaw(text, path), repealed: !revisions.get(id)?.some((r) => r.u) });
}

// --- write
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'laws'), { recursive: true });
mkdirSync(join(OUT, 'feed'), { recursive: true });
const write = (name, value) => writeFileSync(join(OUT, name), JSON.stringify(value));

const dirs = [...new Set([...laws.values()].map((l) => l.dir))].sort();
const lawRows = [];
let pathMismatch = 0;
for (const law of laws.values()) {
  const revs = revisions.get(law.id) ?? [];
  const latest = [...revs].reverse().find((r) => !r.u);
  for (const r of revs) {
    if (r.path !== `laws/${r.path.split('/')[1]}/${law.id.slice(0, 3)}/${law.id}.md`) pathMismatch++;
  }
  lawRows.push([
    law.id, law.title, law.abbrev, law.num, dirs.indexOf(law.dir), law.category, law.kana,
    revs.filter((r) => r.k === 'M' && r.a + r.d > 0).length, latest?.e ?? '', law.repealed ? 1 : 0,
  ]);
  write(`laws/${law.id}.json`, {
    id: law.id,
    path: revs.at(-1)?.path ?? `laws/${law.dir}/${law.id.slice(0, 3)}/${law.id}.md`,
    revs: revs.map(({ path: _path, ...rest }) => rest).reverse(),
  });
}
if (pathMismatch) throw new Error(`${pathMismatch} revisions have an unexpected path`);
write('laws.json', { dirs, rows: lawRows });

const months = [...monthly.keys()].sort().reverse();
for (const month of months) {
  const list = monthly.get(month).sort((x, y) => y.e.localeCompare(x.e));
  write(`feed/${month}.json`, list);
}
upcoming.sort((x, y) => {
  const rank = (e) => (e === 'undetermined' ? '9999' : e);
  return rank(x.e).localeCompare(rank(y.e));
});
write('feed/upcoming.json', upcoming);

write('meta.json', {
  generated: new Date().toISOString(),
  head: git('rev-parse', 'main').trim(),
  headEnforced: months[0] ?? '',
  lawCount: activeCount,
  amendmentCount: [...monthly.values()].reduce((sum, list) => sum + list.length, 0),
  upcomingCount: upcoming.length,
  months: months.map((m) => ({ m, c: monthly.get(m).length })),
});
console.log(`laws: ${laws.size} (active ${activeCount}), months: ${months.length}, upcoming: ${upcoming.length}`);
