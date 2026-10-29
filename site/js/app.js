import * as D from './data.js';
import * as E from './engine.js';
import { renderBody, parseEntry, escapeHtml, scanUrl, cologneUrl } from './render.js';
import { prefs, setPrefs, onPrefs, orderedDicts, resetPrefs } from './prefs.js';
import { renderMorph, lemmasOf } from './grammar.js';
import { renderEtym, etymSummary } from './etym.js';

const $ = (s, el = document) => el.querySelector(s);
const TABS = [['dict', 'Dictionaries'], ['morph', 'Morphology'], ['etym', 'Etymology'], ['corpus', 'Corpus']];

let META = [];
let route = { ns: 'sa', key: '', tab: 'dict' };
let renderToken = 0;

const script = () => prefs().script;
const show = (slp1) => escapeHtml(E.fromSlp1(slp1, script()));
const saSpan = (slp1) => `<span class="sa">${show(slp1)}</span>`;
const href = (ns, key, tab = route.tab) => `#/${ns}/${encodeURIComponent(key)}${tab && tab !== 'dict' ? '/' + tab : ''}`;

// ---- Routing ---------------------------------------------------------------------------------

function parseHash() {
  const [, ns, key, tab] = location.hash.split('/');
  if (ns === 'about') return { ns: 'about' };
  return { ns: ns === 'en' ? 'en' : 'sa', key: key ? decodeURIComponent(key) : '', tab: TABS.some(([t]) => t === tab) ? tab : 'dict' };
}

async function onRoute() {
  route = parseHash();
  if (route.ns === 'about') return renderAbout();
  syncSearchBox();
  if (!route.key) return renderHome();
  await renderWord();
}

// ---- Search box ------------------------------------------------------------------------------

const box = () => $('#q');
const DEVA = /[ऀ-ॿ᳐-᳿꣠-ꣿ]/;

// The box holds Devanagari while the reader types SLP1, as on the Cologne site. Typed Latin
// letters are read as SLP1 and everything is redrawn in Devanagari, which round-trips exactly.
function liveSlp1() {
  return prefs().input === 'Slp1' && $('#ns').value === 'sa';
}

function boxToSlp1(value) {
  if ($('#ns').value === 'en') return value.trim();
  const input = prefs().input;
  if (input !== 'Slp1' && !DEVA.test(value)) return E.toSlp1(value.trim(), input);
  // Mixed Devanagari and SLP1: convert each run.
  return value.replace(/\s+/g, ' ').trim().split(/([ऀ-ॿ᳐-᳿꣠-ꣿ‌‍]+)/)
    .map((run) => (DEVA.test(run) ? E.toSlp1(run, 'Devanagari') : input === 'Slp1' ? run : E.toSlp1(run, input)))
    .join('');
}

function onBoxInput(ev) {
  if (ev.isComposing) return;
  const el = box();
  if (liveSlp1()) {
    const caret = el.selectionStart ?? el.value.length;
    const slp1 = boxToSlp1(el.value);
    const before = boxToSlp1(el.value.slice(0, caret));
    const deva = E.fromSlp1(slp1, 'Devanagari');
    if (deva !== el.value) {
      el.value = deva;
      const pos = Math.min(deva.length, E.fromSlp1(before, 'Devanagari').length);
      el.setSelectionRange(pos, pos);
    }
    $('#preview').textContent = slp1 ? `SLP1: ${slp1}` : '';
  } else if ($('#ns').value === 'sa') {
    const slp1 = boxToSlp1(el.value);
    $('#preview').textContent = slp1 ? `${E.fromSlp1(slp1, 'Devanagari')} · ${slp1}` : '';
  } else {
    $('#preview').textContent = '';
  }
  scheduleSuggest();
}

function syncSearchBox() {
  $('#ns').value = route.ns;
  const el = box();
  if (route.ns === 'en') el.value = route.key;
  else el.value = liveSlp1() ? E.fromSlp1(route.key, 'Devanagari') : prefs().input === 'Devanagari' ? E.fromSlp1(route.key, 'Devanagari') : E.transliterate(route.key, 'Slp1', prefs().input);
  $('#preview').textContent = '';
  hideSuggest();
}

function submitSearch(ev) {
  ev?.preventDefault();
  const ns = $('#ns').value;
  const key = boxToSlp1(box().value);
  if (!key) return;
  hideSuggest();
  location.hash = href(ns, key, route.key ? route.tab : 'dict');
}

// ---- Suggestions -----------------------------------------------------------------------------

let suggestTimer = 0;
let suggestIndex = -1;
function scheduleSuggest() {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(suggest, 120);
}

async function suggest() {
  const ns = $('#ns').value;
  const key = boxToSlp1(box().value);
  if (!key) return hideSuggest();
  const { keys } = await D.headwords(ns);
  const cmp = D.cmpFor(ns);
  const start = D.lowerBound(keys, key, cmp);
  const items = [];
  for (let i = start; i < keys.length && items.length < 12; i++) {
    if (!(ns === 'en' ? keys[i].toLowerCase().startsWith(key.toLowerCase()) : keys[i].startsWith(key))) break;
    items.push(keys[i]);
  }
  const ul = $('#suggest');
  suggestIndex = -1;
  ul.innerHTML = items.map((k) => `<li><a href="${href(ns, k, 'dict')}">${ns === 'en' ? escapeHtml(k) : saSpan(k)}${ns === 'sa' && script() === 'Devanagari' ? ` <span class="muted">${escapeHtml(E.fromSlp1(k, 'Iast'))}</span>` : ''}</a></li>`).join('');
  ul.hidden = !items.length;
}

function hideSuggest() {
  $('#suggest').hidden = true;
  suggestIndex = -1;
}

function onBoxKey(ev) {
  const items = [...$('#suggest').querySelectorAll('a')];
  if ($('#suggest').hidden || !items.length) return;
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    suggestIndex = (suggestIndex + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((a, i) => a.classList.toggle('sel', i === suggestIndex));
  } else if (ev.key === 'Enter' && suggestIndex >= 0) {
    ev.preventDefault();
    location.hash = items[suggestIndex].getAttribute('href');
    hideSuggest();
  } else if (ev.key === 'Escape') {
    hideSuggest();
  }
}

// ---- Lemmatizer status -----------------------------------------------------------------------

function startKosha() {
  const status = $('#kosha-status');
  return E.loadKosha((f) => {
    status.hidden = f >= 1;
    status.innerHTML = `Loading the lemmatizer… ${Math.round(f * 100)}% <span class="muted">(about 30 MB, first visit only)</span>`;
  }).then(() => {
    status.hidden = true;
  }).catch((e) => {
    status.hidden = false;
    status.textContent = `The lemmatizer could not be loaded: ${e.message}`;
  });
}

// ---- Word page -------------------------------------------------------------------------------

async function renderWord() {
  const token = ++renderToken;
  const { ns, key, tab } = route;
  const main = $('#main');
  document.title = `${ns === 'sa' ? E.fromSlp1(key, 'Devanagari') + ' ' + E.fromSlp1(key, 'Iast') : key} — Sanskrit Dictionary`;
  main.innerHTML = `<header class="word-head">
      <h1>${ns === 'sa' ? saSpan(key) : escapeHtml(key)}${ns === 'sa' ? ` <span class="translit">${escapeHtml(E.fromSlp1(key, script() === 'Devanagari' ? 'Iast' : 'Devanagari'))}</span>` : ''}</h1>
      <div id="banner"></div>
    </header>
    <nav class="tabs">${(ns === 'sa' ? TABS : TABS.slice(0, 1)).map(([t, name]) => `<a href="${href(ns, key, t)}" class="${t === tab ? 'on' : ''}">${name}</a>`).join('')}</nav>
    <div id="panel"><p class="muted">Loading…</p></div>`;

  const own = await D.entries(ns, key);
  if (token !== renderToken) return;
  renderNav(ns, key);
  const panel = $('#panel');

  if (tab === 'dict' || ns === 'en') {
    await renderDictTab(panel, ns, key, own, token);
  } else if (tab === 'morph') {
    panel.innerHTML = '<p class="muted">Waiting for the lemmatizer…</p>';
    await startKosha();
    if (token !== renderToken) return;
    await renderMorph(panel, key, script());
  } else if (tab === 'etym') {
    const rec = await D.etymology(key);
    let lemmaRecs = [];
    if (!rec || !rec.cognates?.length) {
      // For an inflected form, show the material for its lemmas.
      await startKosha();
      const lemmas = lemmasOf(E.analyze(key)).slice(0, 4);
      lemmaRecs = await Promise.all(lemmas.map(async (l) => [l, await D.etymology(l)]));
    }
    if (token !== renderToken) return;
    renderEtym(panel, key, rec, META, script(), lemmaRecs);
  } else if (tab === 'corpus') {
    await renderCorpus(panel, key);
  }
  if (ns === 'sa') {
    renderSide(key, own, token);
    startKosha().then(() => token === renderToken && renderNav(ns, key));
  }
}

async function renderDictTab(panel, ns, key, own, token) {
  const dicts = orderedDicts(META).filter((d) => d.ns === ns);
  let html = '';
  let sources = own ? [[key, own, null]] : [];

  if (!own && ns === 'sa') {
    $('#banner').innerHTML = '<p class="note">Not a headword. Looking for its lemma…</p>';
    await startKosha();
    if (token !== renderToken) return;
    const analyses = E.analyze(key);
    const lemmas = lemmasOf(analyses);
    const found = [];
    for (const l of lemmas.slice(0, 10)) {
      const e = await D.entries('sa', l);
      if (e) found.push([l, e, key]);
    }
    if (token !== renderToken) return;
    // Most likely readings first: the lemma covered by the most dictionaries.
    const spread = ([, e]) => new Set(e.map(([i]) => i)).size;
    found.sort((a, b) => spread(b) - spread(a));
    sources = found.slice(0, 3);
    const more = found.slice(3);
    $('#banner').innerHTML = found.length
      ? `<p class="note">${saSpan(key)} is not a headword. The lemmatizer reads it as a form of ${sources.map(([l]) => `<a href="${href('sa', l, 'dict')}">${saSpan(l)}</a>`).join(', ')}${more.length ? `; less likely: ${more.map(([l]) => `<a href="${href('sa', l, 'dict')}">${saSpan(l)}</a>`).join(', ')}` : ''}. <a href="${href('sa', key, 'morph')}">Full analysis →</a></p>`
      : `<p class="note">No dictionary has ${saSpan(key)} as a headword${lemmas.length ? ', and none of its possible lemmas were found either' : ''}. Try the suggestions as you type, or the nearby words on the left.</p>`;
  } else if (!own) {
    $('#banner').innerHTML = `<p class="note">No English–Sanskrit dictionary has “${escapeHtml(key)}” as a headword.</p>`;
  }

  for (const [lemma, entries, form] of sources) {
    if (form) html += `<h2 class="lemma-head">${saSpan(lemma)} <span class="muted">— lemma of ${saSpan(form)}</span></h2>`;
    html += dictBrowser(dicts, entries, lemma);
  }
  panel.innerHTML = html || '';
  panel.querySelectorAll('.dict-browser').forEach((b) => selectDict(b, b.dataset.active));
  panel.onclick = (ev) => {
    const tab = ev.target.closest('.dictbar [data-dict]');
    if (tab) {
      const browser = tab.closest('.dict-browser');
      selectDict(browser, tab.dataset.dict);
      if (tab.dataset.dict !== 'ALL') setPrefs({ activeDict: tab.dataset.dict }, { quiet: true });
      return;
    }
    const arrow = ev.target.closest('[data-scroll]');
    if (arrow) {
      const bar = arrow.parentElement.querySelector('.dictbar');
      bar.scrollBy({ left: Number(arrow.dataset.scroll) * bar.clientWidth * 0.8, behavior: 'smooth' });
      return;
    }
    const en = ev.target.closest('[data-enable]');
    if (en) setPrefs({ hidden: prefs().hidden.filter((c) => c !== en.dataset.enable) });
  };
}

// Logeion-style browser: a bar of dictionaries across the top, one dictionary shown at a time
// (or all of them, stacked, under "All").
function dictBrowser(dicts, entries, key) {
  const byDict = new Map();
  for (const [i, raw] of entries) {
    if (!byDict.has(i)) byDict.set(i, []);
    byDict.get(i).push(parseEntry(raw));
  }
  const present = dicts.filter((d) => byDict.has(d.index));
  const enabled = present.filter((d) => d.enabled);
  const off = present.filter((d) => !d.enabled);
  const wanted = prefs().activeDict;
  const active = enabled.some((d) => d.code === wanted) ? wanted : enabled[0]?.code ?? off[0]?.code ?? 'ALL';
  const tab = (d, cls = '') => `<button type="button" role="tab" class="${cls}" data-dict="${d.code}" title="${escapeHtml(d.title)}${d.bib?.date ? ' (' + escapeHtml(d.bib.date) + ')' : ''}">
      ${escapeHtml(d.short)}<span class="n">${byDict.get(d.index).length}</span></button>`;
  const bar = enabled.map((d) => tab(d)).join('')
    + (enabled.length > 1 ? `<button type="button" role="tab" class="all" data-dict="ALL">All ${enabled.length}</button>` : '')
    + off.map((d) => tab(d, 'off')).join('');
  const sections = present.map((d) => dictSection(d, byDict.get(d.index), key)).join('');
  return `<div class="dict-browser" data-active="${active}">
    <div class="dictbar-wrap">
      <button type="button" class="arrow" data-scroll="-1" aria-label="Scroll dictionaries left">‹</button>
      <nav class="dictbar" role="tablist">${bar}</nav>
      <button type="button" class="arrow" data-scroll="1" aria-label="Scroll dictionaries right">›</button>
    </div>
    ${sections}
  </div>`;
}

function selectDict(browser, code) {
  browser.dataset.active = code;
  const enabledCodes = new Set([...browser.querySelectorAll('.dictbar [data-dict]:not(.off)')].map((b) => b.dataset.dict));
  browser.querySelectorAll('.dictbar [data-dict]').forEach((b) => b.classList.toggle('on', b.dataset.dict === code));
  browser.querySelectorAll('section.dict').forEach((s) => {
    const c = s.id.slice(2);
    s.hidden = code === 'ALL' ? !enabledCodes.has(c) : c !== code;
  });
  // Bring the chosen tab into view by scrolling the bar only, never the page.
  const on = browser.querySelector('.dictbar .on');
  const bar = browser.querySelector('.dictbar');
  if (on && (on.offsetLeft < bar.scrollLeft || on.offsetLeft + on.offsetWidth > bar.scrollLeft + bar.clientWidth)) {
    bar.scrollLeft = on.offsetLeft - 8;
  }
}

function dictSection(d, entries, key) {
  const body = entries.map((e) => {
    // Most dictionaries open the body with the headword itself; add it only when they do not.
    const opensWithHead = /^\s*(<hom>[^<]*<\/hom>\s*)?<(s|b)>/.test(e.body);
    const head = e.key2 && !opensWithHead ? `<b class="hw">${e.hom ? `<sup>${escapeHtml(e.hom)}</sup>` : ''}${show(e.key2)}</b> ` : '';
    const scan = e.pc ? `<a class="pc" href="${scanUrl(d.code, e.pc)}" target="_blank" rel="noopener" title="Scanned page ${escapeHtml(e.pc)}">[${escapeHtml(e.pc)}]</a>` : '';
    return `<div class="entry ${e.level}">${d.ns === 'sa' ? head : ''}${renderBody(e.body, script())} ${scan}</div>`;
  }).join('');
  const b = d.bib ?? {};
  const cite = [b.authors?.join(', '), b.book_title ? `<i>${escapeHtml(b.book_title)}</i>` : '', [b.place, b.publisher].filter(Boolean).join(': '), b.date]
    .filter(Boolean).map((x, i) => (i === 1 ? x : escapeHtml(x))).join('. ');
  return `<section class="dict" id="d-${d.code}">
    <header class="dict-head">
      <h2>${escapeHtml(d.title)}</h2>
      <a class="ext" href="${cologneUrl(d.code, d.year, key)}" target="_blank" rel="noopener" title="Open this entry at Cologne">Cologne ↗</a>
      <p class="cite-line">${cite}${d.enabled ? '' : ` · <a href="javascript:void 0" data-enable="${d.code}">switched off — show it always</a>`}</p>
      <p class="cite-line rights">Digital edition: Cologne Digital Sanskrit Dictionaries. ${rights(d)}</p>
    </header>
    <div class="entries">${body}</div>
  </section>`;
}

// Each dictionary's own credit line and licence, as its Cologne header states them.
function rights(d) {
  const r = d.bib?.rights?.[0] ?? '';
  const lic = d.bib?.licence;
  const name = lic?.includes('by-nc-sa') ? 'CC BY-NC-SA 3.0' : lic?.includes('/by/4.0') ? 'CC BY 4.0' : 'licence';
  return `${escapeHtml(r)}${lic ? ` · <a href="${escapeHtml(lic)}" target="_blank" rel="noopener">${name}</a>` : ''}`;
}

// ---- Left column: nearby words and dictionary jump list --------------------------------------

// Dictionaries organised by lemma. Headwords found only in the others (Sanskrit-Sanskrit kośas,
// indexes, BHS) are often inflected forms such as nominatives or finite verbs, so the word list
// leaves those out.
const LEMMA_DICTS = ['MW', 'MW72', 'PW', 'PWG', 'PWKVN', 'SCH', 'AP90', 'AP', 'MD', 'CAE', 'CCS', 'BEN', 'WIL',
  'YAT', 'GST', 'SHS', 'LRV', 'GRA', 'BOP', 'BUR', 'STC', 'LAN', 'FRI'];

let lemmaList = null;
async function lemmaHeadwords(ns) {
  const { keys, dictIdx } = await D.headwords(ns);
  if (ns === 'en') return keys;
  if (!lemmaList) {
    const core = new Set(META.map((d, i) => (LEMMA_DICTS.includes(d.code) ? String(i) : null)).filter(Boolean));
    // No stem ends in visarga, so keys like gajaH are inflected (nominative) forms.
    lemmaList = keys.filter((k, i) => !k.endsWith('H') && dictIdx[i].split(',').some((d) => core.has(d)));
  }
  return lemmaList;
}

// The left column lists every headword in alphabetical order, drawing only the rows in view.
const ROW = 26;
const nav = { ns: null, keys: [], current: null };

function drawNav() {
  const scroller = $('aside.left');
  const list = $('#nearby');
  const top = scroller.scrollTop - list.offsetTop;
  const first = Math.max(0, Math.floor(top / ROW) - 15);
  const last = Math.min(nav.keys.length, first + Math.ceil(scroller.clientHeight / ROW) + 30);
  let html = '';
  for (let i = first; i < last; i++) {
    const k = nav.keys[i];
    const cur = k === nav.current;
    html += `<li style="top:${i * ROW}px" class="${cur ? 'cur' : ''}"><a href="${href(nav.ns, k, 'dict')}"${cur ? ' aria-current="true"' : ''}>${nav.ns === 'sa' ? saSpan(k) : escapeHtml(k)}</a></li>`;
  }
  list.innerHTML = html;
}

async function renderNav(ns, key) {
  const keys = await lemmaHeadwords(ns);
  const cmp = D.cmpFor(ns);
  let current = key;
  let note = '';
  let at = D.lowerBound(keys, key, cmp);
  if (ns === 'sa' && E.koshaReady()) {
    // An inflected form: highlight its lemma instead, unless the form is itself a headword.
    const isHeadword = keys[at] === key;
    const lemma = lemmasOf(E.analyze(key)).find((l) => l !== key && keys[D.lowerBound(keys, l, cmp)] === l);
    if (lemma && isHeadword) {
      note = `<p class="nav-note">${saSpan(key)} <span class="muted">is also a form of</span> <a href="${href(ns, lemma, 'dict')}">${saSpan(lemma)}</a></p>`;
    } else if (lemma) {
      current = lemma;
      at = D.lowerBound(keys, lemma, cmp);
      note = `<p class="nav-note">${saSpan(key)} <span class="muted">is a form of</span> <a href="${href(ns, lemma, 'dict')}">${saSpan(lemma)}</a></p>`;
    }
  }
  Object.assign(nav, { ns, keys, current: keys[at] === current ? current : null });
  $('#nearby-note').innerHTML = note;
  $('#nearby').style.height = `${keys.length * ROW}px`;
  const scroller = $('aside.left');
  scroller.scrollTop = $('#nearby').offsetTop + at * ROW - scroller.clientHeight / 2 + ROW / 2;
  drawNav();
}

// ---- Right column: at a glance ---------------------------------------------------------------

async function renderSide(key, own, token) {
  const side = $('#side');
  const parts = [];
  const dictCount = new Set((own ?? []).map(([i]) => i)).size;
  parts.push(`<p><b>${dictCount}</b> of ${META.filter((d) => d.ns === 'sa').length} dictionaries have this headword.</p>`);
  const [rec, corp] = await Promise.all([D.etymology(key), D.corpus(key)]);
  if (token !== renderToken) return;
  const summ = etymSummary(rec);
  if (summ) parts.push(`<h4>Comparisons</h4><p>${summ}</p><p><a href="${href('sa', key, 'etym')}">Etymology →</a></p>`);
  if (rec?.rv) parts.push(`<p>Ṛgveda: <b>${rec.rv.passages}</b> passages cited by Grassmann.</p>`);
  if (corp) parts.push(`<h4>Corpus</h4><p><b>${corp.n.toLocaleString()}</b> occurrences in the DCS. <a href="${href('sa', key, 'corpus')}">Corpus →</a></p>`);
  side.innerHTML = parts.join('');
  if (E.koshaReady()) {
    const lemmas = lemmasOf(E.analyze(key)).filter((l) => l !== key).slice(0, 5);
    if (lemmas.length) side.insertAdjacentHTML('afterbegin', `<h4>Possible lemmas</h4><p>${lemmas.map((l) => `<a href="${href('sa', l, 'dict')}">${saSpan(l)}</a>`).join(', ')}</p><p><a href="${href('sa', key, 'morph')}">Morphology →</a></p>`);
  }
}

// ---- Corpus tab ------------------------------------------------------------------------------

async function renderCorpus(panel, key) {
  const [rec, meta] = await Promise.all([D.corpus(key), D.corpusMeta()]);
  if (!meta) {
    panel.innerHTML = '<p>The corpus index has not been built. Run <code>make corpus</code>.</p>';
    return;
  }
  if (!rec) {
    panel.innerHTML = `<p>${saSpan(key)} is not a lemma in the Digital Corpus of Sanskrit. If it is an inflected form, open its lemma from the Morphology tab.</p>${corpusSource(meta)}`;
    return;
  }
  const max = Math.max(...rec.slots, 1);
  const slots = rec.slots.map((c, i) => {
    const total = meta.slotWords[i] || 1;
    const per = (c / total) * 10000;
    return `<tr><th title="${escapeHtml(meta.slotTexts[i].join(', '))}">Slot ${i + 1}</th>
      <td class="bar"><span style="width:${(c / max) * 100}%"></span></td><td class="num">${c.toLocaleString()}</td>
      <td class="num muted">${per.toFixed(2)} per 10,000 words</td></tr>`;
  }).join('');
  const texts = rec.texts.map(([t, c]) => `<tr><td>${escapeHtml(meta.texts[t].name)}</td><td class="num">${c.toLocaleString()}</td><td class="muted">slot ${meta.texts[t].slot ?? '—'}</td></tr>`).join('');
  panel.innerHTML = `<p><b>${rec.n.toLocaleString()}</b> occurrences of ${saSpan(key)} in ${rec.textCount} texts of the Digital Corpus of Sanskrit${rec.gram ? ` (DCS gives the word class as <i>${escapeHtml(rec.gram)}</i>)` : ''}.</p>
    ${rec.meanings ? `<p>DCS gloss: <q>${escapeHtml(rec.meanings)}</q></p>` : ''}
    <h3>By DCS time slot</h3>
    <table class="slots">${slots}</table>
    <p class="muted">The DCS assigns each text to one of five time slots (<code>dcsTimeSlot</code>), spanning roughly 500 BCE to 1900 CE in the earliest to latest slots. The DCS data does not label the slots with dates, so none are given here; hover a slot to see the texts it contains.</p>
    <h3>Texts with the most occurrences</h3><table class="texts">${texts}</table>
    ${corpusSource(meta)}`;
}

function corpusSource(meta) {
  return `<p class="source">Counts computed from the CoNLL-U release of Oliver Hellwig's <a href="https://github.com/OliverHellwig/sanskrit/tree/master/dcs/data/conllu" target="_blank" rel="noopener">Digital Corpus of Sanskrit</a> (CC BY 4.0), ${meta.totalWords.toLocaleString()} words in ${meta.texts.length} texts, commit ${escapeHtml(meta.commit)}. Lemmas are matched to this site's headwords by transliterating DCS's IAST into SLP1. The five-slot scheme spanning 500 BCE–1900 CE is described in <a href="https://bond-lab.github.io/Corpus-Linguistics/pdf/corpora/2015-DigitalSanskritCorpus.pdf" target="_blank" rel="noopener">Kharbanda 2015</a>.</p>`;
}

// ---- Home and About --------------------------------------------------------------------------

function renderHome() {
  document.title = 'Sanskrit Dictionary and Lemmatizer';
  $('#nearby').innerHTML = '';
  $('#nearby').style.height = '';
  $('#nearby-note').innerHTML = '';
  $('#side').innerHTML = '';
  const n = META.reduce((a, d) => a + d.entries, 0);
  $('#main').innerHTML = `<section class="home">
    <h1>Sanskrit Dictionary and Lemmatizer</h1>
    <p>Look up any Sanskrit word in <b>${META.length}</b> dictionaries from the <a href="https://www.sanskrit-lexicon.uni-koeln.de/" target="_blank" rel="noopener">Cologne Digital Sanskrit Dictionaries</a> (${n.toLocaleString()} entries), find the root and grammatical form of an inflected word, see generated conjugation and declension tables with the Pāṇinian rule used at each step, and read the cognates in Greek, Latin, Germanic and other languages that the dictionaries give.</p>
    <p>Type in SLP1 and the search box writes Devanagari as you go (<code>gacCati</code> → गच्छति). Other input schemes are in Settings.</p>
    <p>Try: ${['agni', 'gacCati', 'devAnAm', 'pitf', 'nAman', 'horA', 'BU', 'aSva', 'yuga'].map((k) => `<a href="${href('sa', k, 'dict')}">${saSpan(k)}</a>`).join(' · ')}</p>
    <p><a href="#/about">About the sources and methods</a></p>
  </section>`;
}

function renderAbout() {
  document.title = 'About — Sanskrit Dictionary';
  $('#nearby').innerHTML = '';
  $('#nearby').style.height = '';
  $('#nearby-note').innerHTML = '';
  $('#side').innerHTML = '';
  const rows = META.map((d) => `<tr><td><b>${d.code}</b></td><td>${escapeHtml(d.bib?.authors?.join('; ') ?? '')}</td><td><i>${escapeHtml(d.bib?.book_title || d.title)}</i></td><td>${escapeHtml([d.bib?.place, d.bib?.publisher].filter(Boolean).join(': '))}</td><td>${escapeHtml(d.bib?.date ?? '')}</td><td class="num">${d.entries.toLocaleString()}</td><td>${rights(d) || '<span class="muted">see Cologne</span>'}</td></tr>`).join('');
  $('#main').innerHTML = `<section class="about">
    <h1>About</h1>
    <h2>Dictionaries</h2>
    <p>All dictionaries come from the <a href="https://www.sanskrit-lexicon.uni-koeln.de/" target="_blank" rel="noopener">Cologne Digital Sanskrit Dictionaries</a> (CDSL), University of Cologne. The XML each dictionary publishes on its download page is fetched unchanged and opened read-only; entries are shown as published, with only display formatting applied. Bibliographic details below are read from each dictionary's own header file. Every entry links to its scanned page at Cologne.</p>
    <p>Most of the Cologne digital editions are licensed under <a href="https://creativecommons.org/licenses/by-nc-sa/3.0/" target="_blank" rel="noopener">CC BY-NC-SA 3.0</a> (a few under CC BY 4.0 or GPL v3), which asks that credit be given exactly as stated in each dictionary's header; that statement is shown with every dictionary and in the table below. This site is non-commercial, and the dictionary data it serves is shared under the same terms.</p>
    <table class="biblio"><thead><tr><th>Code</th><th>Author(s)</th><th>Title</th><th>Published</th><th>Date</th><th>Entries</th><th>Digital edition rights</th></tr></thead><tbody>${rows}</tbody></table>
    <h2>Lemmatizer, paradigms and transliteration</h2>
    <p><a href="https://github.com/ambuda-org/vidyut" target="_blank" rel="noopener">Vidyut</a> by Ambuda (MIT license), compiled to WebAssembly and run in your browser: <b>vidyut-kosha</b> (a finite-state transducer of about 29 million forms, prebuilt data release 0.4.0) maps a word to its possible stems and roots; <b>vidyut-prakriya</b> generates paradigms from the Aṣṭādhyāyī and records the rule applied at each step, which is how the derivation tables name their sūtras; <b>vidyut-lipi</b> transliterates. Sūtra texts are from ashtadhyayi.com as distributed with vidyut.</p>
    <h2>Etymology</h2>
    <p>A script reads the comparative material in the dictionaries (Monier-Williams 1872 and 1899, Bopp, Benfey, Lanman, Grassmann, Böhtlingk–Roth, Böhtlingk, Burnouf, Macdonell, Edgerton and others): it finds language labels such as “Gk.”, “lat.”, “goth.”, “Zd.” and the words after them, and every Greek word. Each item keeps the dictionary's exact wording, entry number and printed page. Where several dictionaries compare the same word, the page says so and gives their dates. Sanskrit roots come from Cologne's own extractions (<a href="https://github.com/sanskrit-lexicon/csl-orig/tree/master/v02/etymology_stats" target="_blank" rel="noopener">root_oracle.tsv</a>, <a href="https://github.com/sanskrit-lexicon/csl-orig/tree/master/v02/mw" target="_blank" rel="noopener">mw_etymology.tsv</a>). These are the views of the dictionaries' authors, mostly from the nineteenth century, not a modern etymological dictionary.</p>
    <h2>Corpus</h2>
    <p>Frequencies come from Oliver Hellwig's <a href="https://github.com/OliverHellwig/sanskrit" target="_blank" rel="noopener">Digital Corpus of Sanskrit</a> (CC BY 4.0).</p>
    <h2>Display notes</h2>
    <p>Cologne writes Vedic accents in SLP1 as <code>/</code> (the syllable Lanman and Grassmann print with an acute, e.g. MW <code>a/Msa</code> = Lanman <i>áṃsa</i>), <code>\\</code> and <code>^</code>. In Devanagari these are shown with U+0951 (Unicode name “Devanagari stress sign udatta”), U+0952 (“stress sign anudatta”) and U+1CDA; in IAST with acute, grave and circumflex.</p>
    <p>Your settings (script, input scheme, dictionary order and which dictionaries are shown) are kept in this browser's local storage and never sent anywhere.</p>
  </section>`;
}

// ---- Settings --------------------------------------------------------------------------------

function openSettings() {
  const dlg = $('#settings');
  const p = prefs();
  dlg.querySelector(`input[name=script][value=${p.script}]`).checked = true;
  $('#input-scheme').value = p.input;
  drawDictList();
  dlg.showModal();
}

function drawDictList() {
  const list = $('#dict-order');
  list.innerHTML = orderedDicts(META).map((d) => `<li draggable="true" data-code="${d.code}">
      <span class="grip" aria-hidden="true">⋮⋮</span>
      <label><input type="checkbox" ${d.enabled ? 'checked' : ''} data-toggle="${d.code}"> <b>${d.code}</b> ${escapeHtml(d.short)} <span class="muted">${escapeHtml(d.bib?.date ?? '')} · ${d.ns === 'en' ? 'English–Sanskrit' : d.group}</span></label>
      <span class="move"><button type="button" data-up="${d.code}" aria-label="Move up">↑</button><button type="button" data-down="${d.code}" aria-label="Move down">↓</button></span>
    </li>`).join('');
}

function saveOrderFromList() {
  // A new order should take effect, so forget the last dictionary picked in the bar.
  setPrefs({ order: [...$('#dict-order').children].map((li) => li.dataset.code), activeDict: null });
}

function wireSettings() {
  const dlg = $('#settings');
  $('#open-settings').onclick = openSettings;
  dlg.addEventListener('change', (ev) => {
    if (ev.target.name === 'script') setPrefs({ script: ev.target.value });
    if (ev.target.id === 'input-scheme') setPrefs({ input: ev.target.value });
    if (ev.target.dataset.toggle) {
      const hidden = new Set(prefs().hidden);
      ev.target.checked ? hidden.delete(ev.target.dataset.toggle) : hidden.add(ev.target.dataset.toggle);
      setPrefs({ hidden: [...hidden] });
    }
  });
  dlg.addEventListener('click', (ev) => {
    const up = ev.target.dataset.up, down = ev.target.dataset.down;
    if (up || down) {
      const li = ev.target.closest('li');
      if (up && li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling);
      if (down && li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li);
      saveOrderFromList();
      ev.target.focus();
    }
    if (ev.target.id === 'all-on') { setPrefs({ hidden: [] }); drawDictList(); }
    if (ev.target.id === 'reset') { resetPrefs(); dlg.close(); }
    if (ev.target.id === 'close-settings') dlg.close();
  });
  let dragged = null;
  const list = $('#dict-order');
  list.addEventListener('dragstart', (ev) => { dragged = ev.target.closest('li'); dragged?.classList.add('dragging'); });
  list.addEventListener('dragend', () => { dragged?.classList.remove('dragging'); dragged = null; saveOrderFromList(); });
  list.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    const over = ev.target.closest('li');
    if (!dragged || !over || over === dragged) return;
    const r = over.getBoundingClientRect();
    over.parentNode.insertBefore(dragged, ev.clientY > r.top + r.height / 2 ? over.nextSibling : over);
  });
}

// ---- Start -----------------------------------------------------------------------------------

async function main() {
  await E.initEngine();
  META = await D.dicts();
  wireSettings();
  $('aside.left').addEventListener('scroll', () => nav.keys.length && requestAnimationFrame(drawNav), { passive: true });
  $('#search').addEventListener('submit', submitSearch);
  box().addEventListener('input', onBoxInput);
  box().addEventListener('keydown', onBoxKey);
  box().addEventListener('blur', () => setTimeout(hideSuggest, 150));
  $('#ns').addEventListener('change', () => { box().value = ''; $('#preview').textContent = ''; box().focus(); });
  $('#script-toggle').onclick = () => setPrefs({ script: script() === 'Devanagari' ? 'Iast' : 'Devanagari' });
  document.addEventListener('click', (ev) => {
    const j = ev.target.closest('[data-jump]');
    const sec = j && route.tab === 'dict' && document.getElementById('d-' + j.dataset.jump);
    if (sec) {
      ev.preventDefault();
      const browser = sec.closest('.dict-browser');
      selectDict(browser, j.dataset.jump);
      setPrefs({ activeDict: j.dataset.jump }, { quiet: true });
      browser.scrollIntoView({ behavior: 'smooth' });
    }
  });
  onPrefs(() => {
    $('#script-toggle').textContent = script() === 'Devanagari' ? 'IAST' : 'देव';
    onRoute();
  });
  $('#script-toggle').textContent = script() === 'Devanagari' ? 'IAST' : 'देव';
  window.addEventListener('hashchange', onRoute);
  await onRoute();
  // Fetch the lemmatizer in the background so it is ready when needed.
  startKosha();
  D.headwords('sa');
}

main().catch((e) => {
  document.getElementById('main').innerHTML = `<p class="note">Something went wrong while starting: ${escapeHtml(e.message)}</p>`;
  console.error(e);
});
