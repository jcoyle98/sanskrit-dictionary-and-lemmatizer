// The vidyut WebAssembly engine: transliteration (vidyut-lipi), lemmatization (vidyut-kosha) and
// paradigm generation with step-by-step derivations (vidyut-prakriya).

import init, { Engine, translit } from '../pkg/sanskrit_engine.js';
import { fetchBytes } from './data.js';

const KOSHA_VERSION = 'vidyut-data-0.4.0';
const KOSHA_FILES = ['kosha/padas.fst.gz', 'kosha/registry.msgpack.gz'];

let engine = null;
let koshaPromise = null;

export async function initEngine() {
  await init();
  engine = new Engine();
}

const ACCENTS = { '/': '॑', '\\': '॒', '^': '᳚' };
const IAST_ACCENTS = { '/': '́', '\\': '̀', '^': '̂' };

// SLP1 text, possibly with Vedic accents (/ udātta, \ anudātta, ^ svarita), into `to`.
// vidyut-lipi passes accent characters through unchanged, so we place the marks ourselves:
// each accent follows its vowel, and the pieces in between transliterate independently.
export function fromSlp1(text, to) {
  if (!text) return '';
  if (to === 'Slp1') return text;
  if (!/[/\\^]/.test(text)) return translit(text, 'Slp1', to);
  const marks = to === 'Devanagari' ? ACCENTS : IAST_ACCENTS;
  let out = '';
  for (const piece of text.split(/([/\\^])/)) {
    if (piece in marks) out += marks[piece];
    else if (piece) out += translit(piece, 'Slp1', to);
  }
  return out.normalize('NFC');
}

export const toSlp1 = (text, from) => (from === 'Slp1' ? text : translit(text, from, 'Slp1'));
export const transliterate = translit;

export const koshaReady = () => engine?.has_kosha() ?? false;

async function cachedBytes(path, onProgress) {
  let cache = null;
  try {
    cache = await caches.open(KOSHA_VERSION);
    const hit = await cache.match(path);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch {
    cache = null;
  }
  const bytes = await fetchBytes(path, onProgress);
  try {
    await cache?.put(path, new Response(bytes));
  } catch {
    // Storage may be full or unavailable; the HTTP cache still helps.
  }
  return bytes;
}

// Downloads (first visit) and loads the kosha. `onProgress(fraction)` reports download progress.
export function loadKosha(onProgress = () => {}) {
  if (!koshaPromise) {
    const progress = KOSHA_FILES.map(() => [0, 0]);
    const report = () => {
      const got = progress.reduce((a, [g]) => a + g, 0);
      const total = progress.reduce((a, [, t]) => a + t, 0);
      if (total) onProgress(got / total);
    };
    koshaPromise = Promise.all(
      KOSHA_FILES.map((p, i) =>
        cachedBytes(p, (got, total) => {
          progress[i] = [got, total];
          report();
        }),
      ),
    ).then(([fst, registry]) => {
      engine.load_kosha(fst, registry);
      onProgress(1);
    });
    koshaPromise.catch(() => (koshaPromise = null));
  }
  return koshaPromise;
}

const parse = (s) => JSON.parse(s);
export const analyze = (slp1) => parse(engine.analyze(slp1));
export const findDhatus = (slp1) => parse(engine.find_dhatus(slp1));
export const findPratipadikas = (slp1) => parse(engine.find_pratipadikas(slp1));
export const conjugate = (dhatuSpec, prayoga) => parse(engine.conjugate(JSON.stringify(dhatuSpec), prayoga));
export const decline = (pratipadika, linga) => parse(engine.decline(JSON.stringify(pratipadika), linga));
export const basicPratipadika = (slp1) => parse(engine.basic_pratipadika(slp1));
export const deriveTinanta = (dhatuSpec, prayoga, lakara, purusha, vacana) =>
  parse(engine.derive_tinanta(JSON.stringify(dhatuSpec), prayoga, lakara, purusha, vacana));
export const deriveSubanta = (pratipadika, linga, vibhakti, vacana) =>
  parse(engine.derive_subanta(JSON.stringify(pratipadika), linga, vibhakti, vacana));
