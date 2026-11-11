import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDiff, charMasks, myers } from '../site/js/diff.js';
import { normalizeDoc, normalizeLine } from '../site/js/normalize.js';

const doc = (lines) => lines.map((text, i) => ({ n: i + 1, text, level: 0 }));

function rebuild(rows, a, b) {
  const before = rows.filter((r) => r.t !== 'add').map((r) => a[r.old].text);
  const after = rows.filter((r) => r.t !== 'del').map((r) => b[r.new].text);
  return { before, after };
}

test('rows reproduce both documents', () => {
  const words = ['甲', '乙', '丙', '丁', '戊', '己', '庚'];
  let seed = 7;
  const rand = (n) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  for (let round = 0; round < 300; round++) {
    const a = doc(Array.from({ length: rand(30) }, () => words[rand(7)]));
    const b = doc(Array.from({ length: rand(30) }, () => words[rand(7)]));
    const { rows, added, removed } = computeDiff(a, b);
    const { before, after } = rebuild(rows, a, b);
    assert.deepEqual(before, a.map((l) => l.text));
    assert.deepEqual(after, b.map((l) => l.text));
    assert.equal(added, rows.filter((r) => r.t === 'add').length);
    assert.equal(removed, rows.filter((r) => r.t === 'del').length);
  }
});

test('edit script stops at the limit and reports a replace', () => {
  const ops = myers(Int32Array.from([1, 2, 3, 4]), Int32Array.from([5, 6, 7, 8]), 2);
  assert.equal(ops.filter((o) => o[0] === 1).length, 4);
  assert.equal(ops.filter((o) => o[0] === 2).length, 4);
});

test('a reworded paragraph pairs with its replacement and marks only the change', () => {
  const a = doc(['第一条', '内閣総理大臣は、基本方針を定めなければならない。']);
  const b = doc(['第一条', '防災大臣は、基本方針を定めなければならない。', '新しい項を加える。']);
  const { rows, added, removed } = computeDiff(a, b);
  assert.equal(removed, 1);
  assert.equal(added, 2);
  const del = rows.find((r) => r.t === 'del');
  assert.equal(rows[del.pair].new, 1);
  const { maskA } = charMasks(a[1].text, b[1].text);
  const marked = [...a[1].text].filter((_, i) => maskA[i]).join('');
  assert.equal(marked, '内閣総理');
});

test('revision specific markup does not count as a change', () => {
  const url = (rev) => `[図.jpg](https://laws.e-gov.go.jp/api/2/attachment/${rev}?src=./pict/図.jpg)`;
  const tag = (rev) => `<a href="https://x/${rev}">図.jpg</a>`;
  assert.equal(normalizeLine(url('A')).text, normalizeLine(url('B')).text);
  assert.equal(normalizeLine(tag('A')).text, normalizeLine(tag('B')).text);
  assert.equal(normalizeLine('## 第一条').text, normalizeLine('#### 第一条').text);
  assert.equal(normalizeLine('<tr>'), null);
  assert.equal(normalizeLine('<td>　</td>'), null);
  assert.equal(normalizeLine('<td>死刑</td>').text, '死刑');
});

test('frontmatter is excluded', () => {
  const lines = normalizeDoc('---\ntitle: "x"\nrevision_id: "1"\n---\n\n# 法\n\n本文\n');
  assert.deepEqual(lines.map((l) => l.text), ['法', '本文']);
  assert.equal(lines[0].level, 1);
});
