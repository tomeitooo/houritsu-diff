// Turns the markdown of one law revision into the lines a reader compares.
// Shared by the browser and scripts/build-data.mjs so both count changes the same way.
//
// Heading depth, attachment URLs and table markup change between revisions without the
// statute changing (attachment URLs embed the revision id), so they are removed here.

const STRUCTURAL = /^\s*<\/?(table|thead|tbody|tfoot|tr|colgroup|col)\b[^>]*>\s*$/i;
const INLINE_TAGS = /<\/?(td|th|tr|table|sup|sub|ruby|rb|rp|a|b|i|u|span|div|p)\b[^>]*>/gi;

export function normalizeLine(raw) {
  let s = raw.replace(/\r$/, '');
  if (!s.trim() || STRUCTURAL.test(s)) return null;
  let level = 0;
  const heading = /^(#{1,6})\s+(.*)$/.exec(s);
  if (heading) {
    level = heading[1].length;
    s = heading[2];
  }
  s = s
    .replace(/^\s*[-*]\s+/, '')
    .replace(/\[([^\]]*)\]\(https?:[^)]*\)/g, '$1')
    .replace(/<\/t[dh]>\s*<t[dh]\b[^>]*>/gi, ' ｜ ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<rt\b[^>]*>(.*?)<\/rt>/gi, '（$1）')
    .replace(INLINE_TAGS, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, '$1');
  if (!s.replace(/[\s　]/g, '')) return null;
  return { text: s, level };
}

export function stripFrontmatter(text) {
  if (!text.startsWith('---\n')) return text;
  const end = text.indexOf('\n---\n', 4);
  return end < 0 ? text : text.slice(end + 5);
}

export function normalizeDoc(markdown) {
  const out = [];
  for (const raw of stripFrontmatter(markdown).split('\n')) {
    const line = normalizeLine(raw);
    if (line) out.push({ n: out.length + 1, text: line.text, level: line.level });
  }
  return out;
}
