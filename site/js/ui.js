import { ICONS } from './icons.js';

// All data from the law repository reaches the page through text nodes, never as markup.
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'value') el.value = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child);
  }
}

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 256 256');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  return svg;
}

export function stat(added, removed) {
  return h('span', { class: 'stat', 'aria-label': `追加 ${added} 行、削除 ${removed} 行` },
    h('span', { class: 'a' }, `+${added.toLocaleString()}`),
    h('span', { class: 'd' }, `-${removed.toLocaleString()}`));
}

export const skeleton = () => h('div', { class: 'skel', 'aria-hidden': 'true' },
  h('i'), h('i'), h('i'), h('i'));

const ERAS = [
  ['令和', '2019-05-01', 2018],
  ['平成', '1989-01-08', 1988],
  ['昭和', '1926-12-25', 1925],
  ['大正', '1912-07-30', 1911],
  ['明治', '1868-01-25', 1867],
];

export function fmtDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso ?? '')) return iso === 'undetermined' ? '施行日未定' : iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

export function fmtEra(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso ?? '')) return '';
  const era = ERAS.find(([, start]) => iso >= start);
  if (!era) return '';
  const year = Number(iso.slice(0, 4)) - era[2];
  return `${era[0]}${year === 1 ? '元' : year}年`;
}

export const fmtDateFull = (iso) => {
  const era = fmtEra(iso);
  return era ? `${fmtDate(iso)}（${era}）` : fmtDate(iso);
};

export function safeUrl(url) {
  return /^https:\/\//.test(url ?? '') ? url : null;
}

export const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* preference only */ } },
};
