import { h, icon, stat, skeleton } from './ui.js';
import { computeDiff, charMasks } from './diff.js';
import { normalizeDoc } from './normalize.js';

const SOURCE = 'https://raw.githubusercontent.com/Kohei-Wada/houritsu';
const CONTEXT = 2;
const GAP_STEP = 20;
const ROW_BUDGET = 1500;

const docs = new Map();
export function loadDoc(sha, path) {
  const key = `${sha}/${path}`;
  if (!docs.has(key)) {
    if (docs.size > 40) docs.delete(docs.keys().next().value);
    const promise = fetch(`${SOURCE}/${sha}/${path}`).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return normalizeDoc(await res.text());
    });
    promise.catch(() => docs.delete(key));
    docs.set(key, promise);
  }
  return docs.get(key);
}

export function viewMode() {
  const wide = window.matchMedia('(min-width: 1024px)').matches;
  return wide && document.documentElement.dataset.diffView === 'split' ? 'split' : 'unified';
}

// Colours for statute language, echoing keyword/function/string colours in code.
const NUM = '[一二三四五六七八九十百千〇]+';
const TOKENS = [
  [3, /「[^「」]*」/g],
  [2, new RegExp(`第${NUM}(?:編|章|節|款|目|条|項|号)(?:の${NUM})*(?:第${NUM}(?:項|号)(?:の${NUM})*)*`, 'g')],
  [1, /及び|並びに|若しくは|又は|ただし|かつ/g],
];

function tokenClasses(text) {
  const classes = new Uint8Array(text.length);
  for (const [cls, pattern] of TOKENS) {
    for (const match of text.matchAll(pattern)) classes.fill(cls, match.index, match.index + match[0].length);
  }
  return classes;
}

function renderText(text, mask, wrapTag) {
  const el = h('span', { class: 'text' });
  const classes = tokenClasses(text);
  let group = null;
  let groupOn = -1;
  let start = 0;
  const flushRun = (end, cls) => {
    if (end <= start) return;
    const value = text.slice(start, end);
    (group ?? el).append(cls ? h('span', { class: `t${cls}` }, value) : value);
    start = end;
  };
  for (let i = 0; i <= text.length; i++) {
    const on = i < text.length && mask ? mask[i] : 0;
    const boundary = i === text.length
      || (i > 0 && (classes[i] !== classes[i - 1] || on !== (mask ? mask[i - 1] : 0)));
    if (boundary && i > 0) flushRun(i, classes[i - 1]);
    if (i === text.length) break;
    if (on !== groupOn) {
      groupOn = on;
      if (on) {
        group = h(wrapTag, {});
        el.append(group);
      } else {
        group = null;
      }
    }
  }
  return el;
}

function headingChains(rows, oldDoc, newDoc) {
  const stack = [];
  return rows.map((row) => {
    const line = row.new >= 0 ? newDoc[row.new] : oldDoc[row.old];
    if (line.level > 1) {
      while (stack.length && stack[stack.length - 1].level >= line.level) stack.pop();
      stack.push({ level: line.level, text: line.text });
    }
    return stack.map((entry) => entry.text);
  });
}

function buildSegments(rows) {
  const segments = [];
  let from = -1;
  let to = -1;
  rows.forEach((row, i) => {
    if (row.t === 'eq') return;
    const low = Math.max(0, i - CONTEXT);
    const high = Math.min(rows.length, i + CONTEXT + 1);
    if (from < 0) { from = low; to = high; }
    else if (low <= to) to = Math.max(to, high);
    else { segments.push([from, to]); from = low; to = high; }
  });
  if (from >= 0) segments.push([from, to]);
  return segments;
}

class DiffRenderer {
  constructor(oldDoc, newDoc, diff) {
    Object.assign(this, { oldDoc, newDoc, ...diff });
    this.chains = headingChains(this.rows, oldDoc, newDoc);
    this.masks = new Map();
    this.rowEls = new Map();
    this.mode = viewMode();
  }

  maskFor(index) {
    const row = this.rows[index];
    if (row.pair < 0) return null;
    const del = row.t === 'del' ? index : row.pair;
    if (!this.masks.has(del)) {
      const delRow = this.rows[del];
      const addRow = this.rows[delRow.pair];
      this.masks.set(del, charMasks(this.oldDoc[delRow.old].text, this.newDoc[addRow.new].text));
    }
    const masks = this.masks.get(del);
    return row.t === 'del' ? masks.maskA : masks.maskB;
  }

  line(index) {
    const row = this.rows[index];
    return row.new >= 0 ? this.newDoc[row.new] : this.oldDoc[row.old];
  }

  rowClass(row, line) {
    const type = row.t === 'del' ? ' row--del' : row.t === 'add' ? ' row--add' : '';
    return `row${type}${line.level ? ' is-heading' : ''}`;
  }

  unifiedRow(index) {
    const row = this.rows[index];
    const line = this.line(index);
    const sign = row.t === 'del' ? '-' : row.t === 'add' ? '+' : '';
    const el = h('div', { class: this.rowClass(row, line) },
      h('span', { class: 'edge' }),
      h('span', { class: 'no' }, row.old >= 0 ? this.oldDoc[row.old].n : ''),
      h('span', { class: 'no' }, row.new >= 0 ? this.newDoc[row.new].n : ''),
      h('span', { class: 'sign' }, sign),
      renderText(line.text, this.maskFor(index), row.t === 'del' ? 'del' : 'ins'));
    this.rowEls.set(index, el);
    return el;
  }

  side(index, sideName) {
    if (index === null) return h('div', { class: 'row row--empty' });
    const row = this.rows[index];
    const line = this.line(index);
    const isOld = sideName === 'old';
    const sign = row.t === 'del' ? '-' : row.t === 'add' ? '+' : '';
    const el = h('div', { class: this.rowClass(row, line) },
      h('span', { class: 'edge' }),
      h('span', { class: 'no' }, (isOld ? this.oldDoc[row.old]?.n : this.newDoc[row.new]?.n) ?? ''),
      h('span', { class: 'sign' }, sign),
      renderText(line.text, this.maskFor(index), row.t === 'del' ? 'del' : 'ins'));
    this.rowEls.set(index, el);
    return el;
  }

  splitRows(from, to) {
    const out = [];
    let i = from;
    while (i < to) {
      const row = this.rows[i];
      if (row.t === 'eq') {
        out.push(h('div', { class: 'split-row' }, this.side(i, 'old'), this.sideCopy(i)));
        i++;
        continue;
      }
      const dels = [];
      const adds = [];
      while (i < to && this.rows[i].t !== 'eq') {
        (this.rows[i].t === 'del' ? dels : adds).push(i);
        i++;
      }
      let a = 0;
      for (const del of dels) {
        const pair = this.rows[del].pair;
        if (pair >= 0 && adds.indexOf(pair) >= a) {
          while (adds[a] !== pair) out.push(this.splitLine(null, adds[a++]));
          out.push(this.splitLine(del, adds[a++]));
        } else {
          out.push(this.splitLine(del, null));
        }
      }
      while (a < adds.length) out.push(this.splitLine(null, adds[a++]));
    }
    return out;
  }

  sideCopy(index) {
    const row = this.rows[index];
    const line = this.newDoc[row.new];
    return h('div', { class: this.rowClass(row, line) },
      h('span', { class: 'edge' }),
      h('span', { class: 'no' }, line.n),
      h('span', { class: 'sign' }),
      renderText(line.text, null, 'ins'));
  }

  splitLine(del, add) {
    return h('div', { class: 'split-row' }, this.side(del, 'old'), this.side(add, 'new'));
  }

  rangeEls(from, to) {
    if (this.mode === 'split') return this.splitRows(from, to);
    const out = [];
    for (let i = from; i < to; i++) out.push(this.unifiedRow(i));
    return out;
  }

  crumb(rowIndex) {
    const chain = this.chains[rowIndex];
    return chain.length ? chain.join(' › ') : '本文';
  }

  firstChanged(from, to) {
    for (let i = from; i < to; i++) if (this.rows[i].t !== 'eq') return i;
    return from;
  }

  gapBar(segmentFrom, segmentTo, gap, into) {
    const label = this.crumb(this.firstChanged(segmentFrom, segmentTo));
    const bar = h('div', { class: 'hunk-gap' }, h('span', { class: 'crumb' }, label));
    if (gap.to > gap.from) {
      const button = h('button', { class: 'expand', type: 'button' });
      const refresh = () => { button.textContent = `隠れた ${gap.to - gap.from} 行を表示`; };
      refresh();
      button.addEventListener('click', () => {
        const end = Math.min(gap.to, gap.from + GAP_STEP);
        into.append(...this.rangeEls(gap.from, end));
        gap.from = end;
        if (gap.from >= gap.to) button.remove(); else refresh();
      });
      bar.append(button);
    }
    return bar;
  }

  // Lists the articles this comparison touches, in document order.
  articles() {
    const seen = new Map();
    this.rows.forEach((row, i) => {
      if (row.t === 'eq') return;
      const chain = this.chains[i];
      if (!chain.length) return;
      const short = chain.at(-1).replace(/（.*$/, '').replace(/\u3000/g, ' ');
      const label = chain.length > 1 && chain[0].startsWith('附') ? `附則 ${short}` : short;
      if (!seen.has(label)) seen.set(label, i);
    });
    return [...seen].map(([label, row]) => ({ label, row }));
  }

  renderDiff() {
    const body = h('div', { class: 'diff-body' });
    const segments = buildSegments(this.rows);
    let cursor = 0;
    let budget = ROW_BUDGET;
    const renderFrom = (start) => {
      for (let s = start; s < segments.length; s++) {
        const [from, to] = segments[s];
        const hunk = h('div', { class: 'hunk' });
        body.append(this.gapBar(from, to, { from: cursor, to: from }, hunk));
        hunk.append(...this.rangeEls(from, to));
        body.append(hunk);
        cursor = to;
        budget -= to - from;
        if (budget <= 0 && s + 1 < segments.length) {
          const remaining = segments.length - s - 1;
          const more = h('div', { class: 'load-more', style: 'margin:16px 0' },
            h('button', { class: 'btn', type: 'button', onclick: () => {
              more.remove();
              budget = ROW_BUDGET;
              renderFrom(s + 1);
            } }, `残り ${remaining} か所を表示`));
          body.append(more);
          return;
        }
      }
    };
    renderFrom(0);
    return body;
  }

  renderAll() {
    const body = h('div', { class: 'diff-body' });
    let next = 0;
    const renderChunk = () => {
      const end = Math.min(this.rows.length, next + ROW_BUDGET);
      body.append(h('div', { class: 'hunk' }, this.rangeEls(next, end)));
      next = end;
      if (next < this.rows.length) {
        const more = h('div', { class: 'load-more', style: 'margin:16px 0' },
          h('button', { class: 'btn', type: 'button', onclick: () => { more.remove(); renderChunk(); } },
            `続きの ${this.rows.length - next} 行を表示`));
        body.append(more);
      }
    };
    renderChunk();
    return body;
  }

  scrollTo(row) {
    const el = this.rowEls.get(row);
    if (el) el.scrollIntoView({ block: 'center' });
  }
}

const notice = (title, detail) => h('div', { class: 'notice' }, h('strong', {}, title), detail);

/**
 * Card comparing two revisions, styled like the reference diff.
 * opts.base / opts.target are { sha, path } (or null).
 * opts.kind: 'M' compare, 'N' whole text added, 'S' whole text shown plainly, 'D' repealed.
 */
export function diffCard(opts) {
  const titleEl = opts.href
    ? h('a', { class: 'diff-title', href: opts.href }, opts.title)
    : h('span', { class: 'diff-title' }, opts.title);
  const statSlot = h('span', {});
  const body = h('div', {}, skeleton());
  const card = h('section', { class: 'diff', 'aria-label': opts.title },
    h('header', { class: 'diff-head' }, icon('code'), titleEl, statSlot), body);

  const fail = () => {
    body.replaceChildren(h('div', { class: 'notice' },
      h('strong', {}, '条文を取得できませんでした'),
      '通信状況を確認してください。続く場合は索引の更新を待ってから開き直してください。',
      h('div', {}, h('button', { class: 'btn', type: 'button', onclick: load }, 'もう一度読み込む'))));
  };

  async function load() {
    body.replaceChildren(skeleton());
    try {
      if (opts.kind === 'D') {
        statSlot.replaceChildren();
        body.replaceChildren(notice('この改正で廃止されました', '廃止前の条文は、ひとつ前の版を選ぶと確認できます。'));
        return;
      }
      const [oldDoc, newDoc] = await Promise.all([
        opts.kind === 'M' ? loadDoc(opts.base.sha, opts.base.path) : Promise.resolve([]),
        loadDoc(opts.target.sha, opts.target.path),
      ]);
      if (opts.kind === 'S') {
        const rows = newDoc.map((_, i) => ({ t: 'eq', old: i, new: i, pair: -1 }));
        const view = new DiffRenderer(newDoc, newDoc, { rows, added: 0, removed: 0 });
        body.replaceChildren(
          notice('この版から収録が始まっています', 'これより前の条文は e-Gov の改正履歴に含まれないため、差分はありません。現在の全文を表示しています。'),
          view.renderAll());
        opts.onReady?.({ articles: [], scrollTo: () => {} });
        return;
      }
      const diff = computeDiff(oldDoc, newDoc);
      statSlot.replaceChildren(stat(diff.added, diff.removed));
      const view = new DiffRenderer(oldDoc, newDoc, diff);
      if (!diff.added && !diff.removed) {
        body.replaceChildren(notice('条文の変更はありません', '施行に伴って更新されたのは改正情報だけで、条文の文字は同じです。'));
        opts.onReady?.({ articles: [], scrollTo: () => {} });
        return;
      }
      body.replaceChildren(opts.kind === 'N' ? view.renderAll() : view.renderDiff());
      opts.onReady?.({ articles: view.articles(), scrollTo: (row) => view.scrollTo(row) });
    } catch (error) {
      console.error(error);
      fail();
    }
  }

  if (opts.lazy) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        load();
      }
    }, { rootMargin: '600px' });
    observer.observe(card);
  } else {
    load();
  }
  return card;
}
