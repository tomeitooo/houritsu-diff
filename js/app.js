import { h, icon, stat, skeleton, fmtDate, fmtDateFull, safeUrl, storage } from './ui.js';
import { diffCard } from './diffview.js';

const REPO_URL = 'https://github.com/Kohei-Wada/houritsu';
const main = document.getElementById('main-content');
const nav = document.getElementById('nav');

const json = new Map();
function getJSON(path) {
  if (!json.has(path)) {
    const promise = fetch(`data/${path}`).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
    promise.catch(() => json.delete(path));
    json.set(path, promise);
  }
  return json.get(path);
}

const TYPE_NAMES = {
  act: '法律', 'cabinet-order': '政令', constitution: '憲法',
  'imperial-order': '勅令', 'ministerial-ordinance': '府省令', rule: '規則',
};
const TYPE_FILTERS = [
  ['all', 'すべて'], ['act', '法律'], ['cabinet-order', '政令'], ['ministerial-ordinance', '府省令'], ['rule', '規則'],
];
const POPULAR = [
  ['321CONSTITUTION', '日本国憲法'], ['129AC0000000089', '民法'], ['140AC0000000045', '刑法'],
  ['417AC0000000086', '会社法'], ['322AC0000000049', '労働基準法'], ['415AC0000000057', '個人情報保護法'],
  ['335AC0000000105', '道路交通法'], ['345AC0000000048', '著作権法'],
];

let lawIndex = null;
async function laws() {
  if (lawIndex) return lawIndex;
  const { dirs, rows } = await getJSON('laws.json');
  const list = rows.map(([id, title, abbrev, num, dir, category, kana, changes, latest, repealed]) => ({
    id, title, abbrev, num, dir: dirs[dir], category, kana, changes, latest, repealed: !!repealed,
    path: `laws/${dirs[dir]}/${id.slice(0, 3)}/${id}.md`,
  }));
  lawIndex = { list, byId: new Map(list.map((law) => [law.id, law])) };
  return lawIndex;
}

const applyView = () => {
  document.documentElement.dataset.diffView = storage.get('diffView') === 'split' ? 'split' : 'unified';
};
applyView();

function renderNav(active) {
  const link = (href, label, key) => h('a', { class: 'link', href, 'aria-current': active === key ? 'page' : null }, label);
  const isDark = () => {
    const theme = document.documentElement.dataset.theme;
    return theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const toggle = h('button', {
    class: 'icon-btn', type: 'button', 'aria-label': 'ライトとダークの表示を切り替える',
    onclick: () => {
      const next = isDark() ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      storage.set('theme', next);
      toggle.replaceChildren(icon(next === 'dark' ? 'sun' : 'moon'));
    },
  }, icon(isDark() ? 'sun' : 'moon'));
  nav.replaceChildren(
    h('a', { class: 'brand', href: '#/', 'aria-label': '法令Diff トップ' },
      h('img', { src: 'favicon.svg', alt: '' }), h('span', {}, '法令Diff')),
    link('#/', '最近の改正', 'home'),
    link('#/laws', '法令検索', 'laws'),
    link('#/upcoming', '施行予定', 'upcoming'),
    toggle);
}

function setTitle(text) {
  document.title = text ? `${text} | 法令Diff` : '法令Diff';
}

function loadError(retry) {
  return h('div', { class: 'empty', role: 'alert' },
    h('h2', { class: 'heading-6' }, 'データを読み込めませんでした'),
    h('p', {}, '通信状況を確認して、もう一度お試しください。'),
    h('button', { class: 'btn', type: 'button', onclick: retry }, 'もう一度読み込む'));
}

function searchForm(value, onInput) {
  const input = h('input', {
    type: 'search', placeholder: '法令名、略称、法令番号で探す', 'aria-label': '法令を検索', value: value ?? '', autocomplete: 'off',
    oninput: onInput ? (event) => onInput(event.target.value) : null,
  });
  return h('form', {
    class: 'search', role: 'search',
    onsubmit: (event) => {
      event.preventDefault();
      const query = input.value.trim();
      location.hash = query ? `#/laws?q=${encodeURIComponent(query)}` : '#/laws';
    },
  }, icon('magnifying-glass'), input);
}

function feedItem(entry, index, month) {
  const named = entry.f.slice(0, 3).map(([id]) => index.byId.get(id)?.title ?? id).join('、');
  const more = entry.f.length > 3 ? ` ほか ${entry.f.length - 3} 件` : '';
  const added = entry.f.reduce((sum, f) => sum + f[1], 0);
  const removed = entry.f.reduce((sum, f) => sum + f[2], 0);
  return h('a', { class: 'item', href: `#/amendment/${month}/${entry.s}` },
    h('div', { class: 'item-head' },
      h('h3', { class: 'title-3' }, entry.t),
      entry.f.length && (added || removed) ? stat(added, removed) : null),
    h('p', { class: 'item-sub' }, `${named}${more}`));
}

function renderFeedGroups(container, entries, index, monthOf) {
  let lastDate = null;
  let list = null;
  for (const entry of entries) {
    if (entry.e !== lastDate) {
      lastDate = entry.e;
      container.append(h('h3', { class: 'date-head' }, fmtDateFull(entry.e)));
      list = h('div', { class: 'list' });
      container.append(list);
    }
    list.append(feedItem(entry, index, monthOf(entry)));
  }
}

function typeFilter(state, onChange) {
  const group = h('div', { class: 'filters', role: 'group', 'aria-label': '法令の種類で絞り込む' });
  const draw = () => group.replaceChildren(...TYPE_FILTERS.map(([key, label]) =>
    h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(state.type === key),
      onclick: () => { state.type = key; draw(); onChange(); },
    }, label)));
  draw();
  return group;
}

const matchesType = (entry, type, index) =>
  type === 'all' || entry.f.some(([id]) => index.byId.get(id)?.dir === type);

// Picks a short, recent change to an Act so the first screen shows a real diff.
function pickSample(feed) {
  for (const entry of feed) {
    for (const [id, added, removed, kind] of entry.f) {
      if (kind === 'M' && id.includes('AC') && added >= 1 && removed >= 1 && added + removed <= 8) {
        return { entry, id };
      }
    }
  }
  return null;
}

async function viewHome(token) {
  renderNav('home');
  setTitle('');
  main.replaceChildren(h('div', { class: 'view wrap-narrow' }, skeleton()));
  const [meta, index] = await Promise.all([getJSON('meta.json'), laws()]);
  if (token !== routeToken) return;

  const state = { type: 'all', loaded: [], monthIndex: 0 };
  const feedEl = h('div', {});
  const moreEl = h('div', { class: 'load-more' });

  const drawFeed = () => {
    feedEl.replaceChildren();
    const filtered = state.loaded.filter((entry) => matchesType(entry, state.type, index));
    if (!filtered.length) {
      feedEl.append(h('div', { class: 'empty' },
        h('h2', { class: 'heading-6' }, 'この期間に該当する改正はありません'),
        h('p', {}, '前の月を読み込むと、さらに古い改正を探せます。')));
    } else {
      renderFeedGroups(feedEl, filtered, index, (entry) => entry.e.slice(0, 7));
    }
    moreEl.replaceChildren(state.monthIndex < meta.months.length
      ? h('button', { class: 'btn', type: 'button', onclick: loadMonth }, '前の月を読み込む')
      : h('p', { class: 'muted body-6' }, 'すべての改正を表示しました。'));
  };

  async function loadMonth() {
    moreEl.replaceChildren(skeleton());
    try {
      const { m } = meta.months[state.monthIndex];
      const entries = await getJSON(`feed/${m}.json`);
      state.loaded.push(...entries);
      state.monthIndex++;
      drawFeed();
    } catch (error) {
      console.error(error);
      moreEl.replaceChildren(h('button', { class: 'btn', type: 'button', onclick: loadMonth }, '読み込みに失敗しました。もう一度試す'));
    }
  }

  const first = await getJSON(`feed/${meta.months[0].m}.json`);
  const second = meta.months[1] ? await getJSON(`feed/${meta.months[1].m}.json`) : [];
  if (token !== routeToken) return;
  state.loaded.push(...first, ...second);
  state.monthIndex = Math.min(2, meta.months.length);

  const sample = pickSample([...first, ...second]);
  let sampleCard = null;
  if (sample) {
    const law = index.byId.get(sample.id);
    sampleCard = h('div', {},
      diffCard({
        title: law.title,
        href: `#/law/${law.id}/${sample.entry.s}`,
        kind: 'M',
        base: { sha: sample.entry.ps, path: law.path },
        target: { sha: sample.entry.s, path: law.path },
      }),
      h('p', { class: 'caption-5 faint', style: 'margin-top:8px;text-align:center' },
        `実際の改正から：${sample.entry.t}（${fmtDate(sample.entry.e)} 施行）`));
  }

  drawFeed();
  main.replaceChildren(h('div', { class: 'view wrap-narrow' },
    h('section', { class: 'hero' },
      h('h1', { class: 'heading-1' }, '法律の変化を、', h('br'), '差分で読む。'),
      h('p', { class: 'body-3 muted' },
        `日本の法令 ${meta.lawCount.toLocaleString()} 本の改正を、削除は赤、追加は緑で見比べられます。`),
      searchForm(''),
      h('div', { class: 'quick' }, POPULAR.map(([id, label]) => h('a', { class: 'chip', href: `#/law/${id}` }, label)))),
    sampleCard,
    h('section', {},
      h('div', { class: 'section-head' },
        h('h2', { class: 'heading-5' }, '最近の改正'),
        typeFilter(state, drawFeed)),
      feedEl,
      moreEl)));
}

async function viewUpcoming(token) {
  renderNav('upcoming');
  setTitle('施行予定');
  main.replaceChildren(h('div', { class: 'view wrap-narrow' }, skeleton()));
  const [entries, index] = await Promise.all([getJSON('feed/upcoming.json'), laws()]);
  if (token !== routeToken) return;

  const state = { type: 'all' };
  const feedEl = h('div', {});
  const draw = () => {
    feedEl.replaceChildren();
    const filtered = entries.filter((entry) => matchesType(entry, state.type, index));
    if (!filtered.length) {
      feedEl.append(h('div', { class: 'empty' }, h('h2', { class: 'heading-6' }, '該当する施行予定はありません')));
      return;
    }
    renderFeedGroups(feedEl, filtered, index, () => 'upcoming');
  };
  draw();
  main.replaceChildren(h('div', { class: 'view wrap-narrow' },
    h('header', { class: 'page-head' },
      h('h1', { class: 'heading-4' }, '施行予定の改正'),
      h('p', { class: 'muted' }, `公布済みで、まだ施行されていない改正が ${entries.length.toLocaleString()} 件あります。施行日未定のものは最後に並びます。`)),
    h('div', { class: 'section-head', style: 'margin-top:24px' }, typeFilter(state, draw)),
    feedEl));
}

function rank(law, query) {
  if (law.title === query || law.abbrev.split(',').includes(query)) return 0;
  if (law.title.startsWith(query)) return 1;
  if (law.abbrev.includes(query)) return 2;
  if (law.title.includes(query)) return 3;
  if (law.num.includes(query)) return 4;
  if (law.kana.includes(query)) return 5;
  return -1;
}

async function viewLaws(token, params) {
  renderNav('laws');
  setTitle('法令検索');
  main.replaceChildren(h('div', { class: 'view wrap-narrow' }, skeleton()));
  const index = await laws();
  if (token !== routeToken) return;

  const state = { type: 'all', query: params.get('q') ?? '', shown: 50 };
  const resultEl = h('div', {});
  const heading = h('h2', { class: 'title-4 muted', 'aria-live': 'polite' });

  const draw = () => {
    const query = state.query.trim();
    let results = index.list.filter((law) => state.type === 'all' || law.dir === state.type);
    if (query) {
      results = results
        .map((law) => [rank(law, query), law])
        .filter(([score]) => score >= 0)
        .sort((x, y) => x[0] - y[0] || y[1].changes - x[1].changes)
        .map(([, law]) => law);
      heading.textContent = `${results.length.toLocaleString()} 件見つかりました`;
    } else {
      results = results.filter((law) => !law.repealed).sort((x, y) => y.changes - x.changes);
      heading.textContent = '改正の多い法令';
    }
    if (!results.length) {
      resultEl.replaceChildren(h('div', { class: 'empty' },
        h('h2', { class: 'heading-6' }, `「${query}」に一致する法令はありません`),
        h('p', {}, '略称や法令番号の一部でも検索できます。')));
      return;
    }
    const list = h('div', { class: 'list' }, results.slice(0, state.shown).map((law) =>
      h('a', { class: 'item', href: `#/law/${law.id}` },
        h('div', { class: 'item-head' },
          h('h3', { class: 'title-3' }, law.title),
          law.repealed ? h('span', { class: 'tag tag--repeal' }, '廃止') : h('span', { class: 'caption-5 faint mono' }, `${law.changes} 回改正`)),
        h('p', { class: 'item-sub' }, `${TYPE_NAMES[law.dir] ?? ''}　${law.num}`))));
    resultEl.replaceChildren(list);
    if (results.length > state.shown) {
      resultEl.append(h('div', { class: 'load-more' },
        h('button', { class: 'btn', type: 'button', onclick: () => { state.shown += 50; draw(); } }, 'さらに表示')));
    }
  };

  draw();
  main.replaceChildren(h('div', { class: 'view wrap-narrow' },
    h('header', { class: 'page-head' }, h('h1', { class: 'heading-4', style: 'margin-bottom:16px' }, '法令をさがす')),
    searchForm(state.query, (value) => {
      state.query = value;
      state.shown = 50;
      draw();
      history.replaceState(null, '', value.trim() ? `#/laws?q=${encodeURIComponent(value.trim())}` : '#/laws');
    }),
    h('div', { class: 'section-head', style: 'margin-top:24px' }, heading, typeFilter(state, draw)),
    resultEl));
}

const REV_LABEL = { N: '新規制定', S: '収録開始', D: '廃止' };

function revBadge(rev) {
  if (rev.u) return h('span', { class: 'tag tag--upcoming' }, '施行予定');
  if (rev.k === 'D') return h('span', { class: 'tag tag--repeal' }, '廃止');
  if (rev.k !== 'M') return h('span', { class: 'tag' }, REV_LABEL[rev.k]);
  return rev.a + rev.d > 0 ? stat(rev.a, rev.d) : h('span', { class: 'caption-5 faint' }, '条文変更なし');
}

function viewSwitch(onChange) {
  const current = () => document.documentElement.dataset.diffView;
  const seg = h('div', { class: 'seg seg-view', role: 'group', 'aria-label': '差分の表示形式' });
  const draw = () => seg.replaceChildren(...[['unified', 'rows', '一列'], ['split', 'columns', '左右']].map(([key, name, label]) =>
    h('button', {
      type: 'button', 'aria-pressed': String(current() === key),
      onclick: () => { storage.set('diffView', key); applyView(); draw(); onChange(); },
    }, icon(name), label)));
  draw();
  return seg;
}

let activeLaw = null;

async function viewLaw(token, id, sha, params) {
  renderNav('laws');
  const sameLaw = activeLaw?.id === id && main.contains(activeLaw.pane);
  if (sameLaw) {
    activeLaw.select(sha, params.get('base'));
    return;
  }
  main.replaceChildren(h('div', { class: 'view wrap' }, skeleton()));
  let data;
  const index = await laws();
  const law = index.byId.get(id);
  if (!law) return viewNotFound();
  data = await getJSON(`laws/${id}.json`);
  if (token !== routeToken) return;
  setTitle(law.title);

  const revs = data.revs;
  const pane = h('div', {});
  const link = (rev, base) => `#/law/${id}/${rev.s}${base ? `?base=${base}` : ''}`;
  const revEls = new Map();
  const defaultRev = () => revs.find((rev) => !rev.u) ?? revs[0];

  const timeline = h('aside', { class: 'timeline', 'aria-label': '改正の履歴' },
    h('h2', { class: 'title-4' }, `改正の履歴（${revs.length}）`),
    revs.map((rev) => {
      const el = h('a', { class: 'rev', href: link(rev) },
        h('div', { class: 'rev-top' }, h('span', { class: 'caption-4 muted' }, fmtDate(rev.e)), revBadge(rev)),
        h('div', { class: 'rev-title body-6' }, rev.t));
      revEls.set(rev.s, el);
      return el;
    }));

  const picker = h('select', {
    'aria-label': '表示する改正', onchange: (event) => { location.hash = link(revs[Number(event.target.value)]); },
  }, revs.map((rev, i) => h('option', { value: i }, `${fmtDate(rev.e)} ${rev.t}`)));

  function select(targetSha, baseSha) {
    const revIndex = targetSha ? revs.findIndex((rev) => rev.s === targetSha) : revs.indexOf(defaultRev());
    if (revIndex < 0) { pane.replaceChildren(h('div', { class: 'empty' }, h('h2', { class: 'heading-6' }, 'この版は見つかりませんでした'), h('a', { class: 'btn', href: `#/law/${id}` }, '最新の改正を見る'))); return; }
    const rev = revs[revIndex];
    picker.value = String(revIndex);
    for (const [key, el] of revEls) el.setAttribute('aria-current', String(key === rev.s));
    revEls.get(rev.s)?.scrollIntoView({ block: 'nearest' });

    const older = revs.slice(revIndex + 1).filter((candidate) => candidate.k !== 'D');
    const base = (baseSha && older.find((candidate) => candidate.s === baseSha)) || older[0];
    const compares = rev.k === 'M' || (baseSha && base);
    const kind = compares ? 'M' : rev.k;

    const chips = h('nav', { class: 'chips', 'aria-label': '変更された箇所' });
    const cardSlot = h('div', {});
    const draw = () => cardSlot.replaceChildren(diffCard({
      title: law.title,
      kind,
      base: base ? { sha: base.s, path: data.path } : null,
      target: { sha: rev.s, path: data.path },
      onReady: ({ articles, scrollTo }) => {
        const shown = articles.slice(0, 40);
        chips.replaceChildren(...shown.map((article) =>
          h('button', { class: 'chip', type: 'button', onclick: () => scrollTo(article.row) }, article.label)));
        if (articles.length > shown.length) chips.append(h('span', { class: 'chip' }, `ほか ${articles.length - shown.length} か所`));
      },
    }));

    const baseSelect = older.length && rev.k !== 'D' ? h('label', { class: 'field' }, '比較元の版',
      h('select', {
        value: base ? base.s : '',
        onchange: (event) => { location.hash = link(rev, event.target.value); },
      }, older.map((candidate) => h('option', { value: candidate.s }, `${fmtDate(candidate.e)} ${candidate.t}`)))) : null;
    if (baseSelect && base) baseSelect.querySelector('select').value = base.s;

    pane.replaceChildren(
      h('div', { class: 'rev-head' },
        h('div', {},
          h('h2', { class: 'heading-6' }, rev.t),
          h('div', { class: 'meta', style: 'margin-top:4px' },
            rev.u ? h('span', { class: 'tag tag--upcoming' }, '施行予定') : null,
            h('span', {}, rev.e === 'undetermined' ? '施行日未定' : `${fmtDateFull(rev.e)} 施行`),
            rev.n && rev.n !== '不明' ? h('span', {}, rev.n) : null,
            rev.m ? h('a', { class: 'ext', href: `#/amendment/${rev.m}/${rev.s}` }, 'この改正の全体を見る') : null)),
        h('div', { class: 'toolbar' }, baseSelect ?? h('span', {}), viewSwitch(draw))),
      chips,
      cardSlot);
    draw();
    if (activeLaw) window.scrollTo({ top: 0 });
  }

  main.replaceChildren(h('div', { class: 'view wrap' },
    h('a', { class: 'back', href: '#/laws' }, icon('arrow-left'), '法令をさがす'),
    h('header', { class: 'page-head' },
      h('h1', { class: 'heading-4' }, law.title),
      h('div', { class: 'meta' },
        h('span', { class: 'tag' }, TYPE_NAMES[law.dir] ?? ''),
        law.repealed ? h('span', { class: 'tag tag--repeal' }, '廃止') : null,
        h('span', {}, law.num),
        law.abbrev ? h('span', {}, `略称：${law.abbrev.split(',').join('、')}`) : null,
        h('a', { class: 'ext', href: `https://laws.e-gov.go.jp/law/${id}`, target: '_blank', rel: 'noopener' }, 'e-Gov で正文を見る', icon('arrow-square-out')))),
    h('div', { class: 'law-grid' },
      timeline,
      h('div', {}, h('label', { class: 'field rev-picker', style: 'margin-bottom:16px' }, '表示する改正', picker), pane))));

  activeLaw = { id, pane, select };
  select(sha, params.get('base'));
}

async function viewAmendment(token, month, sha) {
  renderNav(month === 'upcoming' ? 'upcoming' : 'home');
  main.replaceChildren(h('div', { class: 'view wrap-narrow' }, skeleton()));
  if (!/^(\d{4}-\d{2}|upcoming)$/.test(month)) return viewNotFound();
  const [entries, index] = await Promise.all([getJSON(`feed/${month}.json`), laws()]);
  if (token !== routeToken) return;
  const entry = entries.find((candidate) => candidate.s === sha);
  if (!entry) return viewNotFound();
  setTitle(entry.t);

  const isUpcoming = month === 'upcoming';
  const billUrl = safeUrl(entry.bu);
  const cards = h('div', {});
  const draw = () => cards.replaceChildren(...entry.f.map(([id, , , kind]) => {
    const law = index.byId.get(id);
    return diffCard({
      title: law?.title ?? id,
      href: `#/law/${id}/${entry.s}`,
      kind,
      lazy: true,
      base: { sha: entry.ps, path: law.path },
      target: { sha: entry.s, path: law.path },
    });
  }));
  draw();

  main.replaceChildren(h('div', { class: 'view wrap-narrow' },
    h('a', { class: 'back', href: isUpcoming ? '#/upcoming' : '#/' }, icon('arrow-left'), isUpcoming ? '施行予定' : '最近の改正'),
    h('header', { class: 'page-head' },
      h('h1', { class: 'heading-4' }, entry.t),
      h('div', { class: 'meta' },
        isUpcoming ? h('span', { class: 'tag tag--upcoming' }, '施行予定') : null,
        h('span', {}, entry.e === 'undetermined' ? `施行日未定${entry.et ? `：${entry.et}` : ''}` : `${fmtDateFull(entry.e)} 施行`),
        entry.p ? h('span', {}, `${fmtDate(entry.p)} 公布`) : null,
        entry.n && entry.n !== '不明' ? h('span', {}, entry.n) : null),
      entry.b ? h('div', { class: 'meta', style: 'margin-top:8px' },
        h('span', {}, entry.b),
        entry.bs ? h('span', {}, `提出：${entry.bs}`) : null,
        billUrl ? h('a', { class: 'ext', href: billUrl, target: '_blank', rel: 'noopener' }, '議案と提案理由', icon('arrow-square-out')) : null) : null,
      entry.sk ? h('p', { class: 'body-6 muted', style: 'margin-top:8px' }, 'e-Gov に本文がない改正が途中にあるため、この差分にはその分の変更も含まれます。') : null),
    h('div', { class: 'section-head', style: 'margin-top:32px' },
      h('h2', { class: 'heading-6' }, `変更された法令（${entry.f.length}）`),
      viewSwitch(draw)),
    cards));
}

function viewNotFound() {
  renderNav('');
  setTitle('ページが見つかりません');
  main.replaceChildren(h('div', { class: 'view wrap-narrow' },
    h('div', { class: 'empty' },
      h('h1', { class: 'heading-5' }, 'ページが見つかりません'),
      h('p', {}, '法令が移動したか、URL が変更された可能性があります。'),
      h('a', { class: 'btn', href: '#/' }, '最近の改正を見る'))));
}

let routeToken = 0;
async function route() {
  const token = ++routeToken;
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, query] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const params = new URLSearchParams(query ?? '');
  const isLawRoute = parts[0] === 'law';
  try {
    if (!parts.length) await viewHome(token);
    else if (parts[0] === 'laws' && parts.length === 1) await viewLaws(token, params);
    else if (parts[0] === 'upcoming' && parts.length === 1) await viewUpcoming(token);
    else if (isLawRoute && parts.length >= 2 && parts.length <= 3) await viewLaw(token, parts[1], parts[2], params);
    else if (parts[0] === 'amendment' && parts.length === 3) await viewAmendment(token, parts[1], parts[2]);
    else viewNotFound();
  } catch (error) {
    console.error(error);
    if (token === routeToken) main.replaceChildren(h('div', { class: 'view wrap-narrow' }, loadError(route)));
  }
  if (!isLawRoute && token === routeToken) window.scrollTo({ top: 0 });
}

async function renderFooter() {
  const footer = document.getElementById('footer');
  const ext = (href, label) => h('a', { href, target: '_blank', rel: 'noopener' }, label);
  const body = h('div', {},
    h('p', {}, '出典：', ext('https://laws.e-gov.go.jp/', 'e-Gov法令検索'), '（',
      ext('https://www.digital.go.jp/resources/open_data/public_data_license_v1.0', 'PDL1.0'),
      '）。', ext(REPO_URL, 'houritsu'), '（Kohei-Wada、CC BY 4.0）のデータを加工して表示しています。'),
    h('p', {}, '正本は官報です。改正履歴は e-Gov が提供する範囲に限られ、おおむね2015年以降が中心です。このサイトは法的助言ではありません。'));
  footer.replaceChildren(body);
  try {
    const meta = await getJSON('meta.json');
    body.append(h('p', { class: 'mono' }, `データ更新：${fmtDate(meta.generated.slice(0, 10))}`));
  } catch { /* the footer stays useful without the date */ }
}

window.addEventListener('hashchange', route);
renderFooter();
route();
