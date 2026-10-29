// Reader preferences, remembered in this browser (localStorage). Nothing is sent anywhere.

const KEY = 'sdl.prefs.v1';

const DEFAULTS = {
  script: 'Devanagari', // or 'Iast'
  input: 'Slp1', // Slp1 | HarvardKyoto | Iast | Itrans | Velthuis | Devanagari
  order: [], // dictionary codes, highest priority first; unknown codes fall back to default order
  hidden: [], // dictionary codes switched off
  tab: 'dict',
  activeDict: null, // last dictionary picked in the dictionary bar; null = first in order
};

let state = load();
const listeners = new Set();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export const prefs = () => state;

// `quiet` saves without re-rendering, for choices the page has already applied.
export function setPrefs(patch, { quiet = false } = {}) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode or storage disabled: preferences last for this visit only.
  }
  if (!quiet) for (const fn of listeners) fn(state);
}

export const onPrefs = (fn) => listeners.add(fn);

export function resetPrefs() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  state = { ...DEFAULTS };
  for (const fn of listeners) fn(state);
}

// Dictionary metadata sorted by the reader's order, with `enabled` set.
export function orderedDicts(meta) {
  const rank = new Map(state.order.map((c, i) => [c, i]));
  const hidden = new Set(state.hidden);
  return meta
    .map((d, i) => ({ ...d, index: i, enabled: !hidden.has(d.code) }))
    .sort((a, b) => (rank.get(a.code) ?? 1000 + a.index) - (rank.get(b.code) ?? 1000 + b.index));
}
