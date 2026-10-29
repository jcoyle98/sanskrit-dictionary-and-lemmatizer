// Fetching the static index built by scripts/build_*.py.
//
// Shards are gzipped JSON. GitHub Pages serves .gz files as-is, so we inflate them here with
// DecompressionStream; if a server has already decoded them we read the plain bytes.

const BASE = new URL('../data/', import.meta.url);

// Sanskrit alphabetical order of SLP1 characters; must match SLP1_ORDER in build_dicts.py.
const SLP1_ORDER = 'aAiIuUfFxXeEoOMHkKgGNcCjJYwWqQRtTdDnpPbBmyrlvSzsh';
const RANK = new Map([...SLP1_ORDER].map((c, i) => [c, i]));
const rank = (c) => RANK.get(c) ?? 100 + c.codePointAt(0);

export function cmpSlp1(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = rank(a[i]) - rank(b[i]);
    if (d) return d;
  }
  return a.length - b.length;
}

export function cmpEnglish(a, b) {
  const la = a.toLowerCase(), lb = b.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export const cmpFor = (ns) => (ns === 'en' ? cmpEnglish : cmpSlp1);

async function inflate(resp) {
  const buf = new Uint8Array(await resp.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return buf;
}

export async function fetchBytes(path, onProgress) {
  const resp = await fetch(new URL(path, BASE));
  if (!resp.ok) throw new Error(`${path}: HTTP ${resp.status}`);
  if (!onProgress || !resp.body) return inflate(resp);
  const total = Number(resp.headers.get('content-length')) || 0;
  const reader = resp.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(got, total);
  }
  return inflate(new Response(new Blob(chunks)));
}

const memo = new Map();
function once(key, fn) {
  if (!memo.has(key)) {
    const p = fn().catch((e) => {
      memo.delete(key);
      throw e;
    });
    memo.set(key, p);
  }
  return memo.get(key);
}

export const fetchText = (path) => once(path, async () => new TextDecoder().decode(await fetchBytes(path)));
export const fetchJSON = (path) => once('json:' + path, async () => JSON.parse(await fetchText(path)));

// Index of the last shard whose first key is <= key.
function shardIndex(firsts, key, cmp) {
  let lo = 0, hi = firsts.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cmp(firsts[mid], key) <= 0) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

async function shardedGet(dir, key, cmp) {
  const firsts = await fetchJSON(`${dir}/shards.json`);
  const i = shardIndex(firsts, key, cmp);
  const shard = await fetchJSON(`${dir}/${i}.json.gz`);
  return shard[key] ?? null;
}

export const dicts = () => fetchJSON('dicts.json');
export const entries = (ns, key) => shardedGet(ns, key, cmpFor(ns));
export const etymology = (key) => shardedGet('etym', key, cmpSlp1);
export const corpus = (key) => shardedGet('corpus', key, cmpSlp1).catch(() => null);
export const corpusMeta = () => fetchJSON('corpus/meta.json').catch(() => null);
export const rules = () => fetchJSON('grammar/rules.json');

// The full alphabetical headword list, loaded lazily for suggestions and the nearby-words column.
export function headwords(ns) {
  return once('hw:' + ns, async () => {
    const text = await fetchText(`${ns}/headwords.tsv.gz`);
    const keys = [], dictIdx = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      const tab = line.indexOf('\t');
      keys.push(line.slice(0, tab));
      dictIdx.push(line.slice(tab + 1));
    }
    return { keys, dictIdx };
  });
}

// Position where `key` is or would be inserted.
export function lowerBound(keys, key, cmp) {
  let lo = 0, hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cmp(keys[mid], key) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
