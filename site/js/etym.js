// Etymology tab: comparative material extracted from the Cologne dictionaries by
// scripts/build_etym.py, plus Cologne's own root tables. Every item is shown with the
// dictionary's wording and a link to the entry and its printed page.

import { fromSlp1 } from './engine.js';
import { escapeHtml, scanUrl } from './render.js';

const LANG_ORDER = [
  'Greek', 'Latin', 'Oscan', 'Umbrian', 'Gothic', 'Old Norse', 'Old English', 'Old Saxon', 'Old High German',
  'German', 'English', 'Lithuanian', 'Old Prussian', 'Slavic', 'Russian', 'Avestan (Zend)', 'Old Persian',
  'Irish', 'Welsh', 'Armenian', 'Persian', 'Arabic', 'Dravidian', 'Middle Indo-Aryan', 'Modern Indo-Aryan',
];
const order = (l) => (LANG_ORDER.indexOf(l) + 1 || 99);

let S = 'Devanagari';
let META = {};
const sa = (slp1) => `<span class="sa">${escapeHtml(fromSlp1(slp1, S))}</span>`;

const dictLabel = (code) => {
  const d = META[code];
  return d ? `${escapeHtml(d.short)}${d.bib?.pub ? ' ' + d.bib.pub : ''}` : code;
};

function citation(item) {
  const d = META[item.dict];
  const scan = item.pc ? ` · <a href="${scanUrl(item.dict, item.pc)}" target="_blank" rel="noopener">page ${escapeHtml(item.pc)}</a>` : '';
  return `<span class="cite" title="${escapeHtml(d?.title ?? item.dict)}"><a href="#/sa/${encodeURIComponent(item.key)}/dict" data-jump="${item.dict}">${item.dict}</a> L.${escapeHtml(item.L ?? '')}${scan}</span>`;
}

function quote(ctx) {
  return ctx.map(([k, t]) => {
    if (k === 'gk') return `<span class="gk">${escapeHtml(t)}</span>`;
    if (k === 'w') return `<i>${escapeHtml(t)}</i>`;
    if (k === 's') return sa(t);
    if (k === 'lab' || k === 'lab?') return `<b>${escapeHtml(t)}</b>`;
    return escapeHtml(t);
  }).join('');
}

function normWord(w) {
  return w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

// Groups cognate items by language, then by word, keeping every citation.
function byLanguage(items) {
  const langs = new Map();
  for (const it of items) {
    if (!langs.has(it.lang)) langs.set(it.lang, new Map());
    const words = langs.get(it.lang);
    for (const w of it.words) {
      const k = normWord(w) || w;
      if (!words.has(k)) words.set(k, { shown: w, cites: [] });
      if (!words.get(k).cites.some((c) => c.dict === it.dict && c.L === it.L)) words.get(k).cites.push(it);
    }
  }
  return [...langs.entries()].sort((a, b) => order(a[0]) - order(b[0]));
}

function languageTable(items, title, blurb) {
  if (!items.length) return '';
  const rows = byLanguage(items).map(([lang, words]) => {
    const ws = [...words.values()]
      .sort((a, b) => new Set(b.cites.map((c) => c.dict)).size - new Set(a.cites.map((c) => c.dict)).size)
      .map((w) => {
        const dicts = [...new Set(w.cites.map((c) => c.dict))];
        const detail = w.cites.map((c) => `<li>${citation(c)} <q>${quote(c.ctx)}</q></li>`).join('');
        return `<details class="cog"><summary><span class="word ${lang === 'Greek' ? 'gk' : ''}">${escapeHtml(w.shown)}</span>
          <span class="dicts">${dicts.map((d) => `<span class="chip" title="${escapeHtml(META[d]?.title ?? d)}">${dictLabel(d)}</span>`).join('')}</span></summary>
          <ul>${detail}</ul></details>`;
      }).join('');
    return `<tr><th>${escapeHtml(lang)}</th><td>${ws}</td></tr>`;
  }).join('');
  return `<h3>${title}</h3>${blurb ? `<p class="muted">${blurb}</p>` : ''}<table class="cognates">${rows}</table>`;
}

function agreement(rec) {
  if (!rec.agreement?.length) return '';
  const items = rec.agreement.slice(0, 8).map(([lang, , dicts]) => {
    const years = dicts.map((d) => META[d]?.bib?.pub).filter(Boolean);
    const span = years.length ? ` (${Math.min(...years)}–${Math.max(...years)})` : '';
    const shown = rec.cognates.find((c) => c.lang === lang && dicts.includes(c.dict))?.words[0] ?? '';
    return `<li><b>${escapeHtml(lang)}</b> <span class="${lang === 'Greek' ? 'gk' : ''}"><i>${escapeHtml(shown)}</i></span> is compared by <b>${dicts.length}</b> dictionaries${span}: ${dicts.map(dictLabel).join(', ')}</li>`;
  }).join('');
  return `<div class="insight"><h3>Where the dictionaries agree</h3><ul>${items}</ul>
    <p class="muted">Counted from the dictionaries' own wording, matching words after removing accents and hyphens. Some works are related (MW 1899 revises MW 1872; PW abridges PWG), so agreement between them is not independent.</p></div>`;
}

// Text from the build with SLP1 kept in ⟦…⟧, shown in the reader's script.
const withSanskrit = (t) => escapeHtml(t).replace(/⟦([^⟧]*)⟧/g, (_, x) => sa(x.replace(/&amp;/g, '&')));

const QUAL_LABEL = {
  'not': 'rejects this', 'said to be': 'reports it (“said to be”)', 'artificially formed': '“artificially formed”',
  'corrupted': '“corrupted from”', 'fictitiously': '“fictitiously formed”', 'nisi': 'as one option (“nisi”)',
  'more probably': '“more probably”', 'most probably': '“most probably”', 'probably': '“probably”', 'prob.': '“prob.”',
  'perhaps': '“perhaps”', 'possibly': '“possibly”', 'rather': '“rather”', 'doubtful': '“doubtful”', '?': 'with a query',
  'wahrscheinlichste': '“am wahrscheinlichsten”', 'wahrscheinlich': '“wahrscheinlich”', 'wol': '“wol” (probably)',
  'wohl': '“wohl” (probably)', 'vielleicht': '“vielleicht” (perhaps)', 'unsicher': '“unsicher”', 'or': 'as one option (“or”)',
  'oder': 'as one option (“oder”)', 'vel': 'as one option (“vel”)',
};

function formula(it, base) {
  const pre = (it.prefixes ?? []).map((p) => sa(p)).join(' + ');
  const root = (it.kind === 'root' ? '√' : '') + sa(base);
  const aff = it.affix ? it.affix.split('+').map((a) => sa(a)).join(' + ') : '';
  return [pre, root, aff].filter(Boolean).join(' + ');
}

// What the dictionaries say a word is derived from, grouped by the root or base they name.
function derivation(rec, key) {
  const groups = rec.derivations ?? [];
  const assess = rec.assessments ?? [];
  if (!groups.length && !assess.length) return '';
  const support = (g) => g.items.filter((i) => i.qual !== 'not');
  const backed = groups.filter((g) => support(g).length);
  const rejected = groups.flatMap((g) => g.items.filter((i) => i.qual === 'not').map((i) => ({ ...i, base: g.base })));
  const years = (ds) => ds.map((d) => META[d]?.bib?.pub).filter(Boolean);
  const chip = (it) => {
    const extra = [it.source ? `per ${escapeHtml(it.source)}` : '', QUAL_LABEL[it.qual] ?? (it.qual ? `“${escapeHtml(it.qual)}”` : '')].filter(Boolean).join(', ');
    return `<span class="chip" title="${escapeHtml(META[it.dict]?.title ?? it.dict)}">${dictLabel(it.dict)}${extra ? ` · ${extra}` : ''}</span>`;
  };
  let summary = '';
  if (backed.length) {
    const top = backed[0];
    const ds = [...new Set(support(top).map((i) => i.dict))];
    const ys = years(ds);
    summary = `<p class="synth">${ds.length > 1 ? `<b>${ds.length}</b> dictionaries${ys.length ? ` (${Math.min(...ys)}–${Math.max(...ys)})` : ''} derive` : 'One dictionary derives'} ${sa(key)} from <b><a href="#/sa/${encodeURIComponent(top.base)}">${support(top).some((i) => i.kind === 'root') ? '√' : ''}${sa(top.base)}</a></b>${backed.length > 1 ? `; ${backed.length - 1} other derivation${backed.length > 2 ? 's are' : ' is'} also proposed` : ''}${rejected.length ? `, and ${rejected.length === 1 ? 'one is explicitly rejected' : rejected.length + ' are explicitly rejected'}` : ''}.</p>`;
  }
  const rows = backed.map((g) => {
    const items = support(g);
    const detail = items.map((it) => `<li>${formula(it, g.base)} ${chip(it)} ${citation({ ...it, key })}<br><q>${withSanskrit(it.quote)}</q></li>`).join('');
    return `<tr><th><a href="#/sa/${encodeURIComponent(g.base)}">${items.some((i) => i.kind === 'root') ? '√' : ''}${sa(g.base)}</a></th>
      <td><details class="cog"><summary>${items.map(chip).join('')}</summary><ul>${detail}</ul></details></td></tr>`;
  }).join('');
  const rej = rejected.map((it) => `<li>${chip(it)} rejects ${it.kind === 'root' ? '√' : ''}${sa(it.base)}: <q>${withSanskrit(it.quote)}</q> ${citation({ ...it, key })}</li>`).join('');
  const certainty = assess.map((a) => `<li><b>${dictLabel(a.dict)}</b>: <q>${withSanskrit(a.text)}</q> ${citation({ ...a, key })}</li>`).join('');
  return `<div class="insight derivation-box"><h3>Derivation</h3>${summary}
    ${rows ? `<table class="cognates">${rows}</table>` : ''}
    ${rej ? `<p class="muted">Rejected derivations</p><ul class="notes">${rej}</ul>` : ''}
    ${certainty ? `<p class="muted">On how certain this is</p><ul class="notes">${certainty}</ul>` : ''}
    <p class="muted">Read from each dictionary's own wording (MW “fr. √…”, PWG “von …”, Bopp “r. … s. …”, Wilson “E. …”, Apte “[…-…]”, Burnouf “(…)”, Macdonell “[√ …]”, Lanman's bracketed notes, Grassmann's prose). Open a row to see every source's words; only roots and bases that are themselves headwords are counted.</p></div>`;
}

function roots(rec) {
  if (!rec.roots?.length) return '';
  const lines = [];
  for (const r of rec.roots) {
    if (r.via === 'root_oracle') {
      lines.push(`<li>√${sa(r.root)} — supported by ${r.support} source${r.support === 1 ? '' : 's'} (${escapeHtml(r.sources.join(', '))}) in Cologne's <a href="https://github.com/sanskrit-lexicon/csl-orig/tree/master/v02/etymology_stats" target="_blank" rel="noopener">root oracle</a></li>`);
    } else if (r.via === 'mw_etymology') {
      const parse = r.parse ? ` · parse ${sa(r.parse)}` : '';
      lines.push(`<li>√${sa(r.root)} — Monier-Williams, ${escapeHtml(r.deriv || 'derivation')}${parse} <span class="cite">MW L.${escapeHtml(r.L)}</span><br><q class="muted">${escapeHtml(r.text)}</q> <span class="muted">(extracted by Cologne's <a href="https://github.com/sanskrit-lexicon/csl-orig/tree/master/v02/mw" target="_blank" rel="noopener">mw_etymology</a>)</span></li>`);
    } else if (r.via === 'whitney') {
      lines.push(`<li>√${sa(r.root)} — listed in <a href="https://www.sanskrit-lexicon.uni-koeln.de/scans/csl-whitroot/disp/index.php" target="_blank" rel="noopener">Whitney Roots</a> per MW's markup (<code>${escapeHtml(r.text)}</code>) <span class="cite">MW L.${escapeHtml(r.L)}</span></li>`);
    }
  }
  return `<h3>Cologne's root tables</h3><ul class="roots">${lines.join('')}</ul>`;
}

export function renderEtym(el, key, rec, meta, script, lemmaRecs = []) {
  S = script;
  META = Object.fromEntries(meta.map((d) => [d.code, d]));
  const parts = [];
  const blocks = rec ? [[key, rec]] : [];
  for (const [k, r] of lemmaRecs) if (r && k !== key) blocks.push([k, r]);

  if (!blocks.length) {
    el.innerHTML = `<p>No etymological material was found for ${sa(key)} in the Cologne dictionaries or Cologne's root tables.</p>${sourcesNote()}`;
    return;
  }
  for (const [k, r] of blocks) {
    for (const c of r.cognates) c.key = k;
    const ie = r.cognates.filter((c) => c.family === 'ie' && c.kind !== 'loan');
    const loans = r.cognates.filter((c) => c.kind === 'loan');
    const mia = r.cognates.filter((c) => (c.family === 'mia' || c.family === 'nia') && c.kind !== 'loan');
    const other = r.cognates.filter((c) => c.family === 'other' && c.kind !== 'loan');
    parts.push(`<section class="etym-block">${blocks.length > 1 || k !== key ? `<h2>${sa(k)}${k !== key ? ' <span class="muted">(lemma)</span>' : ''}</h2>` : ''}
      ${r.rv ? `<p class="insight">Grassmann's <i>Wörterbuch zum Rig-Veda</i> cites <b>${r.rv.passages}</b> Ṛgveda passages for this word <span class="cite"><a href="#/sa/${encodeURIComponent(k)}/dict" data-jump="GRA">GRA</a> L.${escapeHtml(r.rv.L)} · <a href="${scanUrl('GRA', r.rv.pc)}" target="_blank" rel="noopener">page ${escapeHtml(r.rv.pc)}</a></span></p>` : ''}
      ${derivation(r, k)}
      ${agreement(r)}
      ${languageTable(loans, 'Described as borrowed or derived from', 'Statements such as “fr. Gk.”, “aus”, “borrowed from”. Open each item to read the dictionary’s exact words.')}
      ${languageTable(ie, 'Indo-European comparisons', 'Words in related languages that these dictionaries compare with the Sanskrit. Open an item to see each dictionary’s wording, entry and printed page.')}
      ${languageTable(other, 'Other comparisons', 'Non-Indo-European languages mentioned beside the word; read the wording before treating these as etymologies.')}
      ${languageTable(mia, 'Middle and modern Indo-Aryan forms', 'Pāli, Prakrit and later forms cited beside the word (mostly Edgerton’s BHS).')}
      ${r.notes?.length ? `<h3>Remarks on origin</h3><ul class="notes">${r.notes.map((n) => `<li><q>${escapeHtml(n.text)}</q> ${citation({ ...n, key: k })}</li>`).join('')}</ul>` : ''}
      ${roots(r)}
    </section>`);
  }
  el.innerHTML = parts.join('') + sourcesNote();
}

function sourcesNote() {
  return `<p class="source">Extracted from the Cologne Digital Sanskrit Dictionaries by matching each dictionary's language labels (“Gk.”, “lat.”, “goth.”, “Zd.”…) and the words that follow; items are only as reliable as the nineteenth- and twentieth-century works they come from, and the extraction can misread prose, which is why each item carries the original wording.</p>`;
}

// One-line summary for the side panel.
export function etymSummary(rec) {
  if (!rec?.cognates?.length) return '';
  const best = new Map();
  for (const c of rec.cognates) {
    if (c.family !== 'ie' && c.kind !== 'loan') continue;
    if (!best.has(c.lang)) best.set(c.lang, c);
  }
  return [...best.values()].sort((a, b) => order(a.lang) - order(b.lang)).slice(0, 6)
    .map((c) => `${c.kind === 'loan' ? 'from ' : ''}${escapeHtml(c.lang)} <i class="${c.lang === 'Greek' ? 'gk' : ''}">${escapeHtml(c.words[0])}</i>`).join(' · ');
}
