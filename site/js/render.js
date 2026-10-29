// Renders a Cologne entry line (<H1><h>…</h><body>…</body><tail>…</tail></H1>) as HTML.
//
// The entry text is never altered: tags are mapped to presentation, and Sanskrit inside <s>
// (SLP1) is transliterated into the reader's chosen script.

import { fromSlp1 } from './engine.js';

const TOKEN = /<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export const escapeHtml = (s) =>
  s.replace(/&(?![a-zA-Z]+;|#\d+;|#x[\da-fA-F]+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function attrs(s) {
  const out = {};
  for (const m of s.matchAll(ATTR)) out[m[1]] = m[2] ?? m[3];
  return out;
}

// tag -> [html tag, class]. Anything not listed renders its text with no wrapper.
const INLINE = {
  i: ['i'], b: ['b'], sup: ['sup'], hom: ['b', 'hom'],
  ab: ['abbr', 'ab'], lex: ['i', 'lex'], ls: ['span', 'ls'], is: ['i', 'is'],
  bot: ['i', 'bot'], zoo: ['i', 'bot'], etym: ['i', 'etym'], nsi: ['i', 'etym'],
  gk: ['span', 'gk'], lang: ['span', 'lang'], per: ['span'], title: ['i'],
  arab: ['span', 'foreign'], tib: ['span', 'foreign'], heb: ['span', 'foreign'], rus: ['span', 'foreign'],
  ger: ['span'], fr: ['span'], lat: ['i'], ocs: ['span'], mong: ['span', 'foreign'],
  span: ['span'], note: ['span', 'note'], ed: ['span', 'note'], F: ['span', 'footnote'],
};
const SKIP = new Set(['info', 'lbinfo', 'pc', 'L', 'key1', 'key2', 'pcol', 'tail', 'h', 'old', 'listinfo', 'eid', 'pb', 'pic', 'type', 'xi', 'sic']);
const BREAK = new Set(['br', 'p', 'entrydetail', 'hwdetail', 'Poem']);

// Renders entry body markup. `script` is 'Devanagari' or 'Iast'.
export function renderBody(xml, script) {
  let out = '';
  const stack = [];
  let skipDepth = 0;
  let inSanskrit = 0;

  for (const m of xml.matchAll(TOKEN)) {
    const [, close, tag, rawAttrs, selfClose, text] = m;
    if (text !== undefined) {
      if (skipDepth) continue;
      out += inSanskrit ? sanskrit(text, script) : escapeHtml(text);
      continue;
    }
    if (SKIP.has(tag)) {
      if (!selfClose) skipDepth += close ? -1 : 1;
      continue;
    }
    if (tag === 's1' && close && stack.at(-1) === 's1-skip') {
      stack.pop();
      skipDepth--;
      continue;
    }
    if (skipDepth) continue;
    const a = attrs(rawAttrs);

    if (tag === 's') {
      inSanskrit += close ? -1 : selfClose ? 0 : 1;
      out += close ? '</span>' : selfClose ? '' : '<span class="sa">';
      continue;
    }
    if (tag === 's1') {
      // IAST name with its SLP1 form in an attribute.
      if (!close && !selfClose && a.slp1 && script === 'Devanagari') {
        out += `<span class="sa">${sanskrit(a.slp1, script)}</span>`;
        skipDepth++;
        stack.push('s1-skip');
      }
      continue;
    }
    if (tag === 'C') {
      // Column breaks in tabular entries (INM).
      out += ' | ';
      continue;
    }
    if (tag === 'lb' || (tag === 'div' && a.n === 'lb')) {
      // Line breaks of the printed page.
      out += ' ';
      continue;
    }
    if (tag === 'div') {
      out += close ? '' : '<br class="div">';
      continue;
    }
    if (BREAK.has(tag)) {
      if (!close) out += '<br>';
      continue;
    }
    if (tag === 'lang' && a.n === 'greek') {
      out += close ? '</span>' : '<span class="gk">';
      continue;
    }
    if (tag === 'ls' && !close && a.n) {
      out += `<span class="ls">${escapeHtml(a.n)} `;
      stack.push('span');
      continue;
    }
    const map = INLINE[tag];
    if (!map) continue;
    const [el, cls] = map;
    if (close) {
      out += `</${stack.pop() ?? el}>`;
    } else if (!selfClose) {
      out += cls ? `<${el} class="${cls}">` : `<${el}>`;
      stack.push(el);
    }
  }
  while (stack.length) {
    const el = stack.pop();
    if (el !== 's1-skip') out += `</${el}>`;
  }
  return out;
}

function sanskrit(text, script) {
  // Entities in SLP1 text are rare; decode the common one so it is not transliterated.
  const t = text.replace(/&amp;/g, '&');
  return escapeHtml(fromSlp1(t, script));
}

export function parseEntry(raw) {
  const get = (name) => raw.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? '';
  return {
    key1: get('key1'),
    key2: get('key2'),
    hom: get('hom'),
    L: get('L'),
    pc: get('pc'),
    level: raw.match(/^<(H\w*)>/)?.[1] ?? 'H1',
    body: raw.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '',
  };
}

export const COLOGNE = 'https://www.sanskrit-lexicon.uni-koeln.de/scans';

export const scanUrl = (code, pc) =>
  `${COLOGNE}/csl-apidev/servepdf.php?dict=${code.toLowerCase()}&page=${encodeURIComponent(pc)}`;

export const cologneUrl = (code, year, key) =>
  `${COLOGNE}/${code}Scan/${year}/web/webtc/indexcaller.php?key=${encodeURIComponent(key)}&input=slp1&output=deva`;

export { escapeAttr };
