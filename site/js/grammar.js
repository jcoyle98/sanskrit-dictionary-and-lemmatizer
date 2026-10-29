// Morphology tab: lemmatizer analyses (vidyut-kosha), paradigms and derivations (vidyut-prakriya).
//
// English glosses for grammatical terms follow the doc comments in vidyut-prakriya's
// src/args (e.g. laṭ "sometimes called the present indicative").

import * as E from './engine.js';
import { rules } from './data.js';
import { escapeHtml } from './render.js';

export const LAKARA = [
  ['la~w', 'law', 'present'],
  ['la~N', 'laN', 'imperfect'],
  ['viDili~N', 'viDiliN', 'optative'],
  ['lo~w', 'low', 'imperative'],
  ['lu~N', 'luN', 'aorist'],
  ['li~w', 'liw', 'perfect'],
  ['lu~w', 'luw', 'periphrastic future'],
  ['lf~w', 'lfw', 'simple future'],
  ['lf~N', 'lfN', 'conditional'],
  ['ASIrli~N', 'ASIrliN', 'benedictive'],
  ['le~w', 'lew', 'Vedic subjunctive'],
];
export const PURUSHA = [['praTama', '3rd'], ['maDyama', '2nd'], ['uttama', '1st']];
export const VACANA = [['eka', 'sg.'], ['dvi', 'du.'], ['bahu', 'pl.']];
export const VIBHAKTI = [
  ['praTamA', 'nom.'], ['dvitIyA', 'acc.'], ['tftIyA', 'ins.'], ['caturTI', 'dat.'],
  ['paYcamI', 'abl.'], ['zazWI', 'gen.'], ['saptamI', 'loc.'], ['samboDanam', 'voc.'],
];
export const LINGA = [['puM', 'masc.'], ['strI', 'fem.'], ['napuMsaka', 'neut.']];
export const PRAYOGA = [['kartari', 'active (agent)'], ['karmaRi', 'passive (object)']];
const GANA = ['BvAdi', 'adAdi', 'juhotyAdi', 'divAdi', 'svAdi', 'tudAdi', 'ruDAdi', 'tanAdi', 'kryAdi', 'curAdi', 'kaRqvAdi'];

const label = (table, code) => table.find((r) => r[0] === code);

let S = 'Devanagari';
const sa = (slp1) => `<span class="sa">${escapeHtml(E.fromSlp1(slp1.replace(/~/g, ''), S))}</span>`;
const link = (slp1) => `<a class="sa" href="#/sa/${encodeURIComponent(slp1)}">${escapeHtml(E.fromSlp1(slp1, S))}</a>`;

function lakaraName(code) {
  const l = label(LAKARA, code);
  return l ? `${l[2]} (${sa(l[1])})` : escapeHtml(code);
}

function ganaName(g) {
  const i = GANA.indexOf(g);
  return i < 0 ? '' : i < 10 ? `class ${i + 1} (${sa(g)})` : sa(g);
}

function parseLabel(a) {
  if (a.kind === 'tinanta') {
    const p = label(PURUSHA, a.purusha)?.[1];
    const v = label(VACANA, a.vacana)?.[1];
    const voice = a.prayoga === 'kartari' ? '' : a.prayoga === 'karmaRi' ? ' passive' : ' impersonal';
    return `${p} ${v} ${lakaraName(a.lakara)}${voice}`;
  }
  if (a.avyaya) return 'indeclinable';
  return `${label(VIBHAKTI, a.vibhakti)?.[1]} ${label(VACANA, a.vacana)?.[1]} ${a.lingas_seen.map((l) => label(LINGA, l)?.[1]).join('/')}`;
}

// Groups analyses by lemma and stem type; merges the lingas of otherwise identical subanta parses.
function group(analyses) {
  const groups = new Map();
  for (const a of analyses) {
    const id = a.kind === 'tinanta'
      ? `t|${a.lemma}|${a.dhatu.aupadeshika}|${a.dhatu.gana}|${a.dhatu.prefixes}|${a.dhatu.sanadi}`
      : `s|${a.lemma}|${a.stem_kind}|${a.krt ?? ''}|${a.dhatu?.aupadeshika ?? ''}|${a.dhatu?.gana ?? ''}|${a.dhatu?.sanadi ?? ''}`;
    if (!groups.has(id)) groups.set(id, { head: a, parses: new Map() });
    const g = groups.get(id);
    const pid = a.kind === 'tinanta' ? `${a.prayoga}|${a.lakara}|${a.purusha}|${a.vacana}` : `${a.vibhakti}|${a.vacana}|${a.avyaya}`;
    if (!g.parses.has(pid)) g.parses.set(pid, { ...a, lingas_seen: [] });
    if (a.linga && !g.parses.get(pid).lingas_seen.includes(a.linga)) g.parses.get(pid).lingas_seen.push(a.linga);
  }
  return [...groups.values()];
}

function dhatuLine(d, artha) {
  const bits = [];
  if (d.prefixes?.length) bits.push(`with ${d.prefixes.map(sa).join(' + ')}`);
  if (d.sanadi?.length) bits.push(`+ ${d.sanadi.map(sa).join(' + ')}`);
  return `<span class="muted">Dhātupāṭha ${sa(d.aupadeshika ?? '')}, ${ganaName(d.gana)}${bits.length ? ', ' + bits.join(' ') : ''}${artha ? ` — “${escapeHtml(artha)}”` : ''}</span>`;
}

function groupCard(g, form, i) {
  const a = g.head;
  let title, sub;
  if (a.kind === 'tinanta') {
    title = `${link(a.lemma)} <span class="tag">verb</span>`;
    sub = dhatuLine(a.dhatu, a.artha_en);
  } else if (a.stem_kind === 'krdanta') {
    title = `${link(a.lemma)} <span class="tag">${a.avyaya ? 'indeclinable' : 'participle / verbal noun'}</span>`;
    sub = `<span class="muted">from √${link(a.root)} + ${sa(a.krt)}${a.krt_lakara ? ` (${lakaraName(a.krt_lakara)})` : ''}</span><br>${dhatuLine(a.dhatu, a.artha_en)}`;
  } else {
    title = `${link(a.lemma)} <span class="tag">${a.avyaya ? 'indeclinable' : 'noun / adjective'}</span>`;
    sub = a.lingas?.length ? `<span class="muted">gender in the kosha: ${a.lingas.map((l) => label(LINGA, l)?.[1]).join(', ')}</span>` : '';
  }
  const parses = [...g.parses.values()].map((p) => `<li>${parseLabel(p)}</li>`).join('');
  const canTable = !(a.kind === 'subanta' && a.avyaya);
  return `<section class="card analysis" data-group="${i}">
    <h3>${title}</h3><div>${sub}</div>
    <ul class="parses">${parses}</ul>
    ${canTable ? `<button class="small" data-paradigm="${i}">${a.kind === 'tinanta' ? 'Conjugation' : 'Declension'} table</button>` : ''}
    <div class="paradigm"></div>
  </section>`;
}

// ---- Paradigm tables -------------------------------------------------------------------------

function cell(forms, highlight, data) {
  if (!forms.length) return '<td class="empty">—</td>';
  const hit = forms.some((f) => f === highlight || f.replace(/H$/, 's') === highlight || f.replace(/H$/, 'r') === highlight);
  return `<td class="${hit ? 'hit' : ''}">${forms.map((f) => `<a href="javascript:void 0" class="form" data-derive='${escapeHtml(JSON.stringify(data))}'>${escapeHtml(E.fromSlp1(f, S))}</a>`).join('<br>')}</td>`;
}

function conjugationHtml(dhatu, prayoga, form) {
  const table = E.conjugate(dhatu.spec, prayoga);
  const blocks = LAKARA.filter(([code]) => table[code]).map(([code]) => {
    const rows = table[code];
    if (rows.every((r) => r.every((c) => !c.length))) return '';
    const body = PURUSHA.map(([p, pl], pi) =>
      `<tr><th>${pl}</th>${VACANA.map(([v], vi) => cell(rows[pi][vi], form, { t: 'tin', prayoga, lakara: code, purusha: p, vacana: v })).join('')}</tr>`).join('');
    return `<table class="para"><caption>${lakaraName(code)}</caption>
      <thead><tr><th></th>${VACANA.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
  });
  return `<div class="para-grid">${blocks.join('')}</div>`;
}

function declensionHtml(pratipadika, linga, form) {
  const rows = E.decline(pratipadika, linga);
  const body = VIBHAKTI.map(([vb, vl], i) =>
    `<tr><th>${vl}</th>${VACANA.map(([v], vi) => cell(rows[i][vi], form, { t: 'sup', linga, vibhakti: vb, vacana: v })).join('')}</tr>`).join('');
  return `<table class="para wide"><thead><tr><th></th>${VACANA.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}

function paradigmControls(kind, options, current) {
  return `<div class="seg">${options.map(([code, name]) =>
    `<button class="${code === current ? 'on' : ''}" data-${kind}="${code}">${name}</button>`).join('')}</div>`;
}

function showParadigm(box, spec, form) {
  const draw = () => {
    if (spec.kind === 'tin') {
      box.innerHTML = paradigmControls('prayoga', PRAYOGA, spec.prayoga) + conjugationHtml(spec.dhatu, spec.prayoga, form) + '<div class="derivation"></div>';
    } else {
      const lingas = LINGA.filter(([l]) => spec.lingas.includes(l));
      box.innerHTML = paradigmControls('linga', lingas, spec.linga) + declensionHtml(spec.pratipadika, spec.linga, form) + '<div class="derivation"></div>';
    }
  };
  box.onclick = (ev) => {
    const b = ev.target.closest('button');
    if (b?.dataset.prayoga) { spec.prayoga = b.dataset.prayoga; draw(); }
    if (b?.dataset.linga) { spec.linga = b.dataset.linga; draw(); }
    const f = ev.target.closest('a.form');
    if (f) showDerivation(box.querySelector('.derivation'), spec, JSON.parse(f.dataset.derive), f.textContent);
  };
  draw();
}

// ---- Derivations -----------------------------------------------------------------------------

const SOURCE_NAMES = {
  ashtadhyayi: 'Aṣṭādhyāyī', varttika: 'vārttika', dhatupatha: 'Dhātupāṭha', unadipatha: 'Uṇādipāṭha',
  linganushasana: 'Liṅgānuśāsana', phit: 'Phiṭsūtra', kashika: 'Kāśikā', kaumudi: 'Siddhāntakaumudī', anyatra: 'other',
};

async function showDerivation(box, spec, d, shown) {
  const ps = d.t === 'tin'
    ? E.deriveTinanta(spec.dhatu.spec, d.prayoga, d.lakara, d.purusha, d.vacana)
    : E.deriveSubanta(spec.pratipadika, d.linga, d.vibhakti, d.vacana);
  const R = await rules();
  const html = ps.map((p) => {
    const steps = p.steps.map((s) => {
      const text = R[s.source]?.[s.code];
      const code = s.source === 'ashtadhyayi'
        ? `<a href="https://ashtadhyayi.com/sutraani/${s.code.split('.').join('/')}" target="_blank" rel="noopener">${s.code}</a>`
        : `${SOURCE_NAMES[s.source] ?? s.source} ${escapeHtml(s.code)}`;
      const result = s.result.map((t) => `<span class="${t.changed ? 'changed' : ''}">${escapeHtml(E.fromSlp1(t.text, S))}</span>`).join(' + ');
      return `<tr><td class="code">${code}</td><td class="rule">${text ? sa(text) : ''}</td><td class="res">${result}</td></tr>`;
    }).join('');
    return `<h4>${escapeHtml(E.fromSlp1(p.text, S))}</h4><table class="steps">${steps}</table>`;
  }).join('');
  box.innerHTML = `<h3>Derivation of ${escapeHtml(shown)}</h3>
    <p class="muted">Generated by vidyut-prakriya following the Aṣṭādhyāyī. Each row names the rule applied and the result; changed terms are highlighted. Rule texts from ashtadhyayi.com via vidyut.</p>${html}`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---- Tab entry point -------------------------------------------------------------------------

export async function renderMorph(el, key, script) {
  S = script;
  const analyses = E.analyze(key);
  const groups = group(analyses);
  const dhatus = E.findDhatus(key);
  const stems = E.findPratipadikas(key);
  let html = '';

  if (groups.length) {
    html += `<h2>${sa(key)} as an inflected form <span class="count">${analyses.length} analyses, ${groups.length} lemmas</span></h2>`;
    html += groups.map((g, i) => groupCard(g, key, i)).join('');
  }
  if (dhatus.length) {
    html += `<h2>${sa(key)} as a verbal root</h2>`;
    html += dhatus.map((d, i) => `<section class="card" data-dhatu="${i}"><h3>√${sa(key)} <span class="tag">root</span></h3>
      <div>${dhatuLine(d, d.artha_en)}</div><div class="paradigm"></div></section>`).join('');
  }
  if (stems.length) {
    html += `<h2>${sa(key)} as a nominal stem</h2>`;
    html += stems.map((p, i) => `<section class="card" data-stem="${i}"><h3>${sa(key)} <span class="tag">${p.avyaya ? 'indeclinable' : 'stem'}</span></h3>
      <div class="muted">${p.lingas.length ? 'gender in the kosha: ' + p.lingas.map((l) => label(LINGA, l)?.[1]).join(', ') : ''}</div><div class="paradigm"></div></section>`).join('');
  }
  if (!groups.length && !dhatus.length && !stems.length) {
    html += `<p>The lemmatizer has no analysis of ${sa(key)}. It covers forms generated from the Dhātupāṭha and its stem lists, so compounds, rare words and Vedic forms are often missing.</p>
      <p>You can still generate a declension for ${sa(key)} as a stem:
      ${LINGA.map(([l, n]) => `<button class="small" data-generic="${l}">${n}</button>`).join(' ')}</p><div class="paradigm generic"></div>`;
  }
  html += `<p class="source">Analyses: <a href="https://github.com/ambuda-org/vidyut" target="_blank" rel="noopener">vidyut-kosha</a> (Ambuda, MIT), a finite-state lexicon of forms generated by vidyut-prakriya. Paradigms and derivations: vidyut-prakriya. Glosses of grammatical terms follow vidyut's documentation.</p>`;
  el.innerHTML = html;

  el.onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const card = b.closest('section.card');
    if (b.dataset.paradigm !== undefined) {
      const g = groups[Number(b.dataset.paradigm)];
      const a = g.head;
      const box = card.querySelector('.paradigm');
      if (a.kind === 'tinanta') showParadigm(box, { kind: 'tin', dhatu: a.dhatu, prayoga: a.prayoga === 'kartari' ? 'kartari' : 'karmaRi' }, key);
      else {
        const lingas = a.lingas?.length ? a.lingas : [...g.parses.values()].flatMap((p) => p.lingas_seen);
        const first = [...g.parses.values()][0].lingas_seen[0] ?? lingas[0] ?? 'puM';
        showParadigm(box, { kind: 'sup', pratipadika: a.pratipadika, lingas: [...new Set(lingas.length ? lingas : ['puM', 'strI', 'napuMsaka'])], linga: first }, key);
      }
      b.remove();
    } else if (b.dataset.generic) {
      showParadigm(el.querySelector('.paradigm.generic'), { kind: 'sup', pratipadika: E.basicPratipadika(key), lingas: ['puM', 'strI', 'napuMsaka'], linga: b.dataset.generic }, key);
    }
  };
  // Roots and stems show their tables straight away.
  el.querySelectorAll('section[data-dhatu]').forEach((card) => {
    showParadigm(card.querySelector('.paradigm'), { kind: 'tin', dhatu: dhatus[Number(card.dataset.dhatu)], prayoga: 'kartari' }, key);
  });
  el.querySelectorAll('section[data-stem]').forEach((card) => {
    const p = stems[Number(card.dataset.stem)];
    if (p.avyaya) return;
    const lingas = p.lingas.length ? p.lingas : ['puM', 'strI', 'napuMsaka'];
    showParadigm(card.querySelector('.paradigm'), { kind: 'sup', pratipadika: p.pratipadika, lingas, linga: lingas[0] }, key);
  });
  return { analyses, groups };
}

// Distinct lemmas (stems and roots) proposed for a form, most specific first.
export function lemmasOf(analyses) {
  const out = [];
  for (const a of analyses) {
    for (const l of [a.lemma, a.root]) if (l && !out.includes(l)) out.push(l);
  }
  return out;
}

// "Parsed as a form of: …" — every lemma the kosha proposes, with its parses, as one line.
// Readings that print identically (the kosha often derives one stem several ways) are merged;
// plain nouns and finite verbs come before derived stems.
export function parseLine(analyses, script, hrefFor) {
  S = script;
  const merged = new Map();
  for (const g of group(analyses)) {
    const a = g.head;
    const derived = a.kind === 'subanta' && a.stem_kind === 'krdanta';
    const kind = a.kind === 'tinanta' ? 'verb' : derived ? `from √${link(a.root)}` : a.avyaya ? 'indeclinable' : 'noun/adj.';
    const id = `${a.lemma}|${kind}`;
    if (!merged.has(id)) merged.set(id, { a, kind, rank: derived ? 1 : 0, parses: new Set() });
    for (const p of g.parses.values()) merged.get(id).parses.add(parseLabel(p));
  }
  return [...merged.values()].sort((x, y) => x.rank - y.rank).map(({ a, kind, parses }) => {
    const lemma = `<a class="sa lemma" href="${hrefFor(a.lemma)}">${escapeHtml(E.fromSlp1(a.lemma, S))}</a>`;
    return `<li>${lemma} <span class="kind">${kind}</span> <span class="parse">${[...parses].join('; ')}</span></li>`;
  });
}
