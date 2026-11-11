// Line diff (Myers), paragraph pairing, and character level highlights.

const MAX_LINE_D = 6000;
const MAX_CHAR_D = 1500;
const MAX_CHAR_LEN = 12000;

// Shortest edit script over integer arrays. Returns [op, i, j] with op 0 = equal,
// 1 = delete a[i], 2 = insert b[j]. Past maxD the middle is reported as a full replace.
export function myers(a, b, maxD) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const ops = [];
  for (let i = 0; i < start; i++) ops.push([0, i, i]);
  const n = endA - start;
  const m = endB - start;
  const middle = editScript(a, b, start, n, m, maxD);
  if (middle) {
    for (const op of middle) ops.push(op);
  } else {
    for (let i = 0; i < n; i++) ops.push([1, start + i, -1]);
    for (let j = 0; j < m; j++) ops.push([2, -1, start + j]);
  }
  for (let i = endA, j = endB; i < a.length; i++, j++) ops.push([0, i, j]);
  return ops;
}

function editScript(a, b, off, n, m, maxD) {
  if (n === 0 || m === 0) {
    const ops = [];
    for (let i = 0; i < n; i++) ops.push([1, off + i, -1]);
    for (let j = 0; j < m; j++) ops.push([2, -1, off + j]);
    return ops;
  }
  const limit = Math.min(n + m, maxD);
  const size = 2 * limit + 3;
  const mid = limit + 1;
  const v = new Int32Array(size);
  const trace = [];
  let found = -1;
  outer: for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(mid - d - 1, mid + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[mid + k - 1] < v[mid + k + 1])
        ? v[mid + k + 1]
        : v[mid + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[off + x] === b[off + y]) { x++; y++; }
      v[mid + k] = x;
      if (x >= n && y >= m) { found = d; break outer; }
    }
  }
  if (found < 0) return null;

  const ops = [];
  let x = n;
  let y = m;
  for (let d = found; d >= 0; d--) {
    const prev = trace[d];
    const at = (k) => prev[k + d + 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; ops.push([0, off + x, off + y]); }
    if (d > 0) {
      if (down) { y--; ops.push([2, -1, off + y]); } else { x--; ops.push([1, off + x, -1]); }
    }
  }
  return ops.reverse();
}

function bigrams(text) {
  const counts = new Map();
  for (let i = 0; i < text.length - 1; i++) {
    const gram = text.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }
  return counts;
}

function similarity(x, y) {
  if (x.text === y.text) return 1;
  let shared = 0;
  const [small, large] = x.grams.size < y.grams.size ? [x.grams, y.grams] : [y.grams, x.grams];
  for (const [gram, count] of small) shared += Math.min(count, large.get(gram) || 0);
  const total = x.text.length + y.text.length - 2;
  return total > 0 ? (2 * shared) / total : 0;
}

const PAIR_THRESHOLD = 0.3;

// Aligns deleted and inserted paragraphs in order, maximising total similarity.
export function pairBlock(dels, adds) {
  const pairs = [];
  if (!dels.length || !adds.length) return pairs;
  const left = dels.map((text) => ({ text, grams: bigrams(text) }));
  const right = adds.map((text) => ({ text, grams: bigrams(text) }));
  if (left.length * right.length > 40000) {
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      if (similarity(left[i], right[i]) >= PAIR_THRESHOLD) pairs.push([i, i]);
    }
    return pairs;
  }
  const rows = left.length;
  const cols = right.length;
  const sim = Array.from({ length: rows }, (_, i) =>
    Float32Array.from({ length: cols }, (_, j) => similarity(left[i], right[j])));
  const best = Array.from({ length: rows + 1 }, () => new Float32Array(cols + 1));
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      const take = sim[i][j] >= PAIR_THRESHOLD ? sim[i][j] + best[i + 1][j + 1] : 0;
      best[i][j] = Math.max(take, best[i + 1][j], best[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (sim[i][j] >= PAIR_THRESHOLD
        && Math.abs(best[i][j] - (sim[i][j] + best[i + 1][j + 1])) < 1e-4) {
      pairs.push([i, j]);
      i++; j++;
    } else if (best[i + 1][j] >= best[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

// Boolean masks marking the characters that differ between two paragraphs.
export function charMasks(a, b) {
  const maskA = new Uint8Array(a.length);
  const maskB = new Uint8Array(b.length);
  if (a.length + b.length > MAX_CHAR_LEN) {
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
    maskA.fill(1, start, endA);
    maskB.fill(1, start, endB);
    return { maskA, maskB };
  }
  const toCodes = (s) => Int32Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));
  for (const [op, i, j] of myers(toCodes(a), toCodes(b), MAX_CHAR_D)) {
    if (op === 1) maskA[i] = 1;
    if (op === 2) maskB[j] = 1;
  }
  smooth(maskA, a);
  smooth(maskB, b);
  return { maskA, maskB };
}

// A single unchanged character between two changes reads as noise, so it joins them.
// Surrogate pairs are kept whole so a highlight can never split a character.
function smooth(mask, text) {
  for (let i = 1; i < mask.length - 1; i++) {
    if (!mask[i] && mask[i - 1] && mask[i + 1]) mask[i] = 1;
  }
  for (let i = 1; i < mask.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xdc00 && code <= 0xdfff) mask[i] = mask[i - 1];
  }
}

// Full comparison of two normalized documents.
// Each row: { t: 'eq'|'del'|'add', old, new, pair } where old/new index the documents and
// pair is the row index of the matching paragraph on the other side.
export function computeDiff(oldDoc, newDoc) {
  const ids = new Map();
  const intern = (line) => {
    let id = ids.get(line.text);
    if (id === undefined) { id = ids.size; ids.set(line.text, id); }
    return id;
  };
  const a = Int32Array.from(oldDoc, intern);
  const b = Int32Array.from(newDoc, intern);
  const ops = myers(a, b, MAX_LINE_D);

  const rows = [];
  let added = 0;
  let removed = 0;
  let index = 0;
  while (index < ops.length) {
    if (ops[index][0] === 0) {
      rows.push({ t: 'eq', old: ops[index][1], new: ops[index][2], pair: -1 });
      index++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (index < ops.length && ops[index][0] !== 0) {
      if (ops[index][0] === 1) dels.push(ops[index][1]); else adds.push(ops[index][2]);
      index++;
    }
    const base = rows.length;
    for (const i of dels) rows.push({ t: 'del', old: i, new: -1, pair: -1 });
    for (const j of adds) rows.push({ t: 'add', old: -1, new: j, pair: -1 });
    removed += dels.length;
    added += adds.length;
    const pairs = pairBlock(dels.map((i) => oldDoc[i].text), adds.map((j) => newDoc[j].text));
    for (const [i, j] of pairs) {
      const delRow = base + i;
      const addRow = base + dels.length + j;
      rows[delRow].pair = addRow;
      rows[addRow].pair = delRow;
    }
  }
  return { rows, added, removed };
}
