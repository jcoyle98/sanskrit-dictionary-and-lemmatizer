"""Extract etymological evidence from the Cologne dictionaries.

For every Sanskrit headword this collects, with a citation for each item:

- cognates and loan sources: a language label ("Gk.", "lat.", "Goth.", "Zd.", ...)
  and the words the dictionary gives after it, plus every Greek-script word;
- the Sanskrit root, from Cologne's own extractions (csl-orig mw_etymology.tsv
  and etymology_stats/root_oracle.tsv) and from MW's <info> markup;
- Grassmann's count of cited Rigveda passages.

Every item keeps the dictionary, entry L-number, page-column and the
dictionary's own wording (as a list of [kind, text] segments) so the claim can
be checked against the source. Nothing is inferred beyond what the text says.

Output: site/data/etym/<n>.json.gz, sharded like the dictionary index.
"""

import csv
import gzip
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data-src" / "cdsl"
OUT = ROOT / "site" / "data" / "etym"
sys.path.insert(0, str(ROOT / "scripts"))
from build_dicts import read_bibliography, read_entries, slp1_sort_key  # noqa: E402

# Dictionaries whose <lang> tags or abbreviations mark comparative material.
SOURCES = ["MW", "MW72", "BOP", "BEN", "LAN", "GRA", "PWG", "PW", "BUR", "MD",
           "CAE", "CCS", "AP90", "WIL", "YAT", "GST", "SCH", "STC", "BHS"]

# label -> (language, family). Family drives grouping in the UI:
#   ie       Indo-European languages outside Indo-Aryan
#   mia      Middle Indo-Aryan (Pali, Prakrits, ...): later reflexes, not cognates
#   nia      modern Indo-Aryan
#   other    languages outside Indo-European (possible loan sources)
LANGS = {
    "Greek": ("ie", ["Gk.", "Gk", "Gr.", "gr.", "griech.", "Griech.", "Greek", "graec.", "gr", "grec"]),
    "Latin": ("ie", ["Lat.", "lat.", "Latin", "lat", "Lat", "latin"]),
    "Gothic": ("ie", ["Goth.", "goth.", "go.", "Got.", "Gothic", "goth"]),
    "German": ("ie", ["Germ.", "germ.", "deutsche", "deutschen", "Mod. Germ.", "HGerm.", "nhd.", "German", "germ", "all."]),
    "Old High German": ("ie", ["germ. vet.", "Old Germ.", "Old High Germ.", "O. H. G.", "O.H.G.", "althochd.", "ahd.", "Old High German", "a. h. d."]),
    "Old English": ("ie", ["Angl.Sax.", "Angl. Sax.", "A.S.", "A. S.", "ags.", "angls.", "Anglo-Saxon", "angl.-sax."]),
    "English": ("ie", ["Eng.", "Engl.", "English", "angl."]),
    "Old Saxon": ("ie", ["Old Sax.", "alts."]),
    "Old Norse": ("ie", ["Icel.", "altn.", "Old Norse", "Scand.", "isl."]),
    "Lithuanian": ("ie", ["Lith.", "lith.", "lit.", "litth.", "Lit.", "lituan.", "Lithuanian"]),
    "Old Prussian": ("ie", ["Pruss.", "Boruss.", "altpr."]),
    "Slavic": ("ie", ["Slav.", "slav.", "altsl.", "O. Slav.", "Old Slav.", "ksl.", "slav", "Slavonic"]),
    "Russian": ("ie", ["Russ.", "russ."]),
    "Avestan (Zend)": ("ie", ["Zd.", "Zend", "zend.", "Zend.", "Av.", "avest.", "zend", "Zd"]),
    "Old Persian": ("ie", ["Old Pers.", "altpers.", "O. Pers."]),
    "Persian": ("other", ["Pers.", "pers.", "Persian", "Pers", "neupers.", "persan"]),
    "Irish": ("ie", ["Hib.", "Ir.", "Irish", "irisch", "ir."]),
    "Welsh": ("ie", ["Cymr.", "Welsh", "cymr."]),
    "Armenian": ("ie", ["Armen.", "armen."]),
    "Oscan": ("ie", ["Osc.", "osk."]),
    "Umbrian": ("ie", ["Umbr.", "umbr."]),
    "Middle Indo-Aryan": ("mia", ["Pāli", "Pali", "Prākṛt", "Prākṛ.", "Prakrit", "Prākrit", "Pkt.", "AMg.", "Apabhraṃśa", "Pr.", "MIndic", "Pāli."]),
    "Modern Indo-Aryan": ("nia", ["Hindī", "Hindi", "Bengālī", "beng.", "mahr.", "mahratt.", "Marāṭhī", "Hind.", "Nep.", "Guj."]),
    "Arabic": ("other", ["Arabic", "arab.", "Arab."]),
    "Dravidian": ("other", ["Tamil", "Telugu", "Kanarese", "Canarese", "Malayalam", "Drav.", "Dravidian", "Tam.", "Tel."]),
}
ALIAS = {}
for lang, (fam, labels) in LANGS.items():
    for l in labels:
        ALIAS[l] = lang
FAMILY = {lang: fam for lang, (fam, _) in LANGS.items()}

# Labels that are also ordinary words or abbreviations in prose; trusted only when the
# dictionary itself tagged them (<lang>/<ab>), never as bare text.
TAG_ONLY = {"gr", "lat", "goth", "germ", "zend", "slav", "Lat", "Pers", "Zd", "Gk", "lit.", "Lit.",
            "Pr.", "all.", "ir.", "go.", "gr.", "grec", "latin", "Ir.", "Pali", "Pāli", "English",
            "Tam.", "Tel.", "Hind.", "Nep.", "Guj.", "A. S.", "isl."}
PLAIN_LABELS = sorted((l for l in ALIAS if l not in TAG_ONLY), key=len, reverse=True)
# Abbreviations that also mean something else in some dictionaries ("lit." = literally,
# "pers." = person, "Pr." = present, "gr." = Bopp's grammar). Unless tagged <lang>, these count
# only when an italic or Greek word follows.
AMBIGUOUS = {"lit.", "Lit.", "lith.", "pers.", "Pers.", "Pr.", "gr.", "Gr.", "Ir.", "ir.", "all.", "germ."}
# Grammatical abbreviations that trail cited words in plain text.
STOP = {"of", "the", "a", "an", "in", "is", "with", "see", "and", "or", "der", "die", "das", "und",
        "von", "ist", "le", "la", "les", "de", "du", "et", "cognate", "glossary", "word", "form",
        "ausg", "ed", "comp", "s", "to", "from"}
GRAM = {"n", "m", "f", "fem", "masc", "neut", "pl", "sg", "du", "id", "nom", "gen", "acc", "dat",
        "loc", "abl", "instr", "them", "cf", "v", "etc", "c", "adj", "adv", "part", "pf", "praes"}
PLAIN_RE = re.compile(r"(?<![\w.])(" + "|".join(re.escape(l) for l in PLAIN_LABELS) + r")(?!\w)")

LOAN_CUE = re.compile(r"(?i)(\bfr\.|\bfrom( the)?|borrowed( fr\.| from)?|\baus( dem)?|entlehnt|lehnwort|fremdwort|emprunté( du| de)?|c'est le mot|\bloan(word)?)\W*$")
NOTE_RE = re.compile(r"(?i)(dravid|non-aryan|un-aryan|foreign (origin|word)|fremdwort|fremden ursprungs|lehnwort|entlehnt|emprunté|mot étranger|borrowed from)")

GREEK = re.compile(r"[Ͱ-Ͽἀ-῿]")
SEG_RE = re.compile(
    r"<(gk|etym|nsi|i|ab|lang|s|s1|b|is)(?:\s[^>]*)?>(.*?)</\1>"
    r"|<lang n=\"greek\">(.*?)</lang>"
    r"|<[^>]+>"
    r"|([^<]+)",
    re.S,
)


def segments(body: str):
    """Flatten an entry body into [kind, text] segments.

    kinds: t (plain), w (italic/cited word), gk (Greek), lab (tagged label), s (SLP1).
    """
    out = []
    for m in SEG_RE.finditer(body):
        tag, inner, greek, text = m.group(1), m.group(2), m.group(3), m.group(4)
        if greek is not None:
            out.append(["gk", strip_tags(greek)])
        elif tag:
            inner_text = strip_tags(inner)
            if not inner_text:
                continue
            if tag == "gk" or GREEK.search(inner_text):
                out.append(["gk", inner_text])
            elif tag in ("lang", "ab") and inner_text.strip() in ALIAS:
                out.append(["lab" if tag == "lang" else "lab?", inner_text.strip()])
            elif tag in ("s", "s1"):
                out.append(["s", inner_text])
            elif tag in ("etym", "nsi", "i", "is", "b"):
                out.append(["w", inner_text])
            else:
                out.append(["t", inner_text])
        elif text:
            out.append(["t", text.replace("&amp;", "&")])
    return out


def strip_tags(s):
    return re.sub(r"<[^>]+>", "", s).replace("&amp;", "&")


def explode_plain_labels(segs):
    """Split plain-text segments so that untagged labels ('Gr.', 'Goth.') become lab segments."""
    out = []
    for kind, text in segs:
        if kind != "t":
            out.append([kind, text])
            continue
        pos = 0
        for m in PLAIN_RE.finditer(text):
            if m.start() > pos:
                out.append(["t", text[pos:m.start()]])
            out.append(["lab?", m.group(1)])
            pos = m.end()
        if pos < len(text):
            out.append(["t", text[pos:]])
    return out


TERMINATORS = re.compile(r"[;\[\]()]|\.\s*$|\.\s+[A-Z]")
JOINERS = re.compile(r"^\s*(,|and|or|und|oder|et|ou|=|\s)*\s*$")


def plain_words(text):
    """Words given in plain text right after a label, up to a terminator."""
    m = TERMINATORS.search(text)
    chunk = text[: m.start()] if m else text
    items = []
    for part in re.split(r",|\band\b|\bor\b|\bund\b|\boder\b|\bet\b", chunk):
        words = [x for x in part.split() if x.strip(".=").lower() not in GRAM | STOP]
        w = " ".join(words[:2]).strip(" .:'‘’\"“”")
        if w and len(words) <= 3 and not re.search(r"\d", w) and len(w) < 30:
            items.append(w)
    return items[:3], bool(m)


def extract(segs):
    """Find (label, words, start, end) runs in a segment list."""
    found = []
    i = 0
    n = len(segs)
    while i < n:
        kind, text = segs[i]
        if kind == "gk":
            # A Greek word with no label is still a Greek comparison.
            prev_lab = next((s for s in reversed(segs[max(0, i - 3):i]) if s[0] in ("lab", "lab?")), None)
            word = text.strip(" ,.;")
            if prev_lab is None and len(word) > 1:
                found.append(("Greek", [word], i, i))
            i += 1
            continue
        if kind not in ("lab", "lab?"):
            i += 1
            continue
        if kind == "lab?" and text in AMBIGUOUS:
            nxt = next((s for s in segs[i + 1:i + 3] if not (s[0] == "t" and JOINERS.match(s[1]))), None)
            if not nxt or nxt[0] not in ("w", "gk"):
                i += 1
                continue
        lang = ALIAS[text]
        words, j = [], i + 1
        while j < n:
            k2, t2 = segs[j]
            if k2 in ("w", "gk"):
                if not GREEK.search(t2) and re.search(r"\d", t2):
                    break
                words.append(t2.strip(" ,.;:"))
                j += 1
            elif k2 == "t":
                if JOINERS.match(t2):
                    j += 1
                    continue
                if not words:
                    ws, stopped = plain_words(t2)
                    words.extend(ws)
                    j += 1
                break
            elif k2 in ("lab", "lab?"):
                # "Goth. and Germ. un": both labels share the following words.
                if not words:
                    nested = extract(segs[j:])
                    if nested and nested[0][2] == 0:
                        found.append((lang, nested[0][1], i, j + nested[0][3]))
                break
            else:
                break
        words = [w.lstrip("= ") for w in words
                 if len(w.strip("-")) > 1 and "(" not in w and ")" not in w
                 and not all(x.strip(".,").lower() in STOP for x in w.split())]
        if words:
            found.append((lang, words, i, j - 1))
        i = max(j, i + 1)
    return found


def context(segs, start, end, pad=2):
    """The dictionary's own wording around a match, trimmed to a readable window."""
    lo, hi = max(0, start - pad), min(len(segs), end + pad + 1)
    window = [list(s) for s in segs[lo:hi]]
    if lo > 0 and window and window[0][0] == "t":
        window[0][1] = "…" + window[0][1][-60:]
    if hi < len(segs) and window and window[-1][0] == "t":
        window[-1][1] = window[-1][1][:60] + "…"
    return window


def norm_word(w):
    w = unicodedata.normalize("NFD", w.lower())
    w = "".join(c for c in w if not unicodedata.combining(c))
    return re.sub(r"[^\w]", "", w)


def body_of(raw):
    m = re.search(r"<body>(.*)</body>", raw, re.S)
    return m.group(1) if m else ""


def tail_field(raw, name):
    m = re.search(rf"<{name}>([^<]*)</{name}>", raw)
    return m.group(1) if m else ""


def main():
    dicts = json.loads((ROOT / "scripts" / "dicts.json").read_text())
    pub = {d["code"]: read_bibliography(d["code"])["pub"] or 9999 for d in dicts}
    data = defaultdict(lambda: {"cognates": [], "notes": [], "roots": [], "rv": None})

    for code in SOURCES:
        n_items = 0
        for key1, L, raw in read_entries(code):
            body = body_of(raw)
            pc = tail_field(raw, "pc")
            if code == "GRA":
                refs = len(re.findall(r"\{\d+,\d+\}", body))
                if refs:
                    rec = data[key1]
                    rec["rv"] = {"dict": code, "L": L, "pc": pc, "passages": refs + (rec["rv"] or {}).get("passages", 0)}
            segs = explode_plain_labels(segments(body))
            for lang, words, s, e in extract(segs):
                fam = FAMILY[lang]
                if code == "BHS" and fam not in ("mia", "ie"):
                    continue
                before = "".join(t for k, t in segs[max(0, s - 2):s] if k in ("t", "w"))
                # "fr." right after another foreign word explains that word, not the Sanskrit one.
                inside_chain = any(k in ("gk", "w", "lab", "lab?") for k, _ in segs[max(0, s - 3):s])
                kind = "loan" if (LOAN_CUE.search(before) and not inside_chain) else (
                    "cognate" if fam == "ie" else "parallel" if fam in ("mia", "nia") else "comparison")
                data[key1]["cognates"].append({
                    "lang": lang, "family": fam, "kind": kind, "words": words,
                    "norm": [norm_word(w) for w in words],
                    "dict": code, "L": L, "pc": pc, "ctx": context(segs, s, e),
                })
                n_items += 1
            text = "".join(t for _, t in segs)
            for m in NOTE_RE.finditer(text):
                a, b = max(0, m.start() - 120), min(len(text), m.end() + 120)
                data[key1]["notes"].append({"dict": code, "L": L, "pc": pc,
                                            "text": ("…" if a else "") + text[a:b].strip() + ("…" if b < len(text) else "")})
        print(f"{code:5} {n_items} comparative items", file=sys.stderr)

    # MW's own markup of roots: <info verb=...>, <info whitneyroots=...>.
    for key1, L, raw in read_entries("MW"):
        m = re.search(r'<info whitneyroots="([^"]*)"', raw)
        if m:
            data[key1]["roots"].append({"via": "whitney", "dict": "MW", "L": L, "pc": tail_field(raw, "pc"),
                                        "root": m.group(1).split(",")[0], "text": m.group(1)})

    orig = SRC / "csl-orig"
    with open(orig / "mw__mw_etymology.tsv", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            if not row.get("root_slp1"):
                continue
            data[row["headword_slp1"]]["roots"].append({
                "via": "mw_etymology", "dict": "MW", "L": row["L_id"], "root": row["root_slp1"],
                "deriv": row["deriv_type"], "parse": row["parse"], "affix": row["affix_slp1"],
                "prefixes": row["prefixes"], "text": row["context"],
            })
    with open(orig / "etymology_stats__root_oracle.tsv", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            data[row["form_slp1"]]["roots"].append({
                "via": "root_oracle", "root": row["root_slp1"], "support": int(row["support"] or 0),
                "sources": row["sources"].split(","),
            })

    # Cross-dictionary agreement: how many distinct dictionaries cite the same word in a language.
    for rec in data.values():
        agree = defaultdict(set)
        for c in rec["cognates"]:
            for w in c["norm"]:
                if w:
                    agree[(c["lang"], w)].add(c["dict"])
        rec["agreement"] = sorted(
            ([lang, w, sorted(ds, key=lambda d: pub[d])]
             for (lang, w), ds in agree.items() if len(ds) > 1),
            key=lambda x: -len(x[2]))
        for c in rec["cognates"]:
            del c["norm"]

    data = {k: v for k, v in data.items() if v["cognates"] or v["notes"] or v["roots"] or v["rv"]}
    write_shards(data)


def write_shards(data):
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json.gz"):
        old.unlink()
    firsts = json.loads((ROOT / "site" / "data" / "sa" / "shards.json").read_text())
    # Reuse the dictionary shard boundaries, merged 8 to 1 to keep file counts down.
    bounds = firsts[::8]
    shards = defaultdict(dict)
    import bisect
    keys_sorted = [slp1_sort_key(b) for b in bounds]
    for k, v in data.items():
        i = max(0, bisect.bisect_right(keys_sorted, slp1_sort_key(k)) - 1)
        shards[i][k] = v
    for i, shard in shards.items():
        with gzip.open(OUT / f"{i}.json.gz", "wt", encoding="utf-8", compresslevel=9) as f:
            json.dump(shard, f, ensure_ascii=False, separators=(",", ":"))
    (OUT / "shards.json").write_text(json.dumps(bounds, ensure_ascii=False))
    n_cog = sum(1 for v in data.values() if v["cognates"])
    print(f"etym: {len(data)} headwords ({n_cog} with comparative material) in {len(shards)} shards")


if __name__ == "__main__":
    main()
