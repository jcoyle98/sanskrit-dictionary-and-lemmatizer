"""Lemma frequencies from Oliver Hellwig's Digital Corpus of Sanskrit (DCS, CC BY 4.0).

Reads the CoNLL-U release (data-src/dcs/dcs/data/conllu): every word line's LEMMA
column, the text it belongs to, and that text's `dcsTimeSlot` from
lookup/chapter-info.xml. Lemmas are IAST; they are converted to SLP1 so they
match the dictionary headwords.

Output:
  site/data/corpus/meta.json      texts, time slots, totals, DCS commit
  site/data/corpus/<n>.json.gz    {slp1_lemma: {n, slots, texts, textCount, gram, meanings}}
"""

import bisect
import csv
import gzip
import json
import re
import subprocess
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DCS = ROOT / "data-src" / "dcs"
# Optional first argument: another copy of the conllu directory.
CONLLU = Path(sys.argv[1]) if len(sys.argv) > 1 else DCS / "dcs" / "data" / "conllu"
OUT = ROOT / "site" / "data" / "corpus"
sys.path.insert(0, str(ROOT / "scripts"))
from build_dicts import slp1_sort_key  # noqa: E402
from translit import iast_to_slp1  # noqa: E402

csv.field_size_limit(10_000_000)

def chapter_slots():
    """Map chapter file path (relative to files/) -> (text name, time slot)."""
    text = (CONLLU / "lookup" / "chapter-info.xml").read_text(encoding="utf-8")
    out = {}
    for m in re.finditer(r"<chapter>(.*?)</chapter>", text, re.S):
        block = m.group(1)
        path = re.search(r"<path>([^<]*)</path>", block).group(1)
        name = re.search(r"<textName>([^<]*)</textName>", block).group(1)
        slot = re.search(r"<dcsTimeSlot>([^<]*)</dcsTimeSlot>", block)
        slot = int(slot.group(1)) if slot and slot.group(1).isdigit() else None
        out[unicodedata.normalize("NFC", path)] = (name, slot)
    return out


def dictionary_info():
    """DCS lexicon: lemma id -> (grammar, meanings)."""
    info = {}
    with open(CONLLU / "lookup" / "dictionary.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            info[row["id"]] = (row.get("grammar", ""), row.get("meanings", ""))
    return info


def main():
    chapters = chapter_slots()
    lexicon = dictionary_info()
    text_ids, texts = {}, []
    counts = defaultdict(Counter)        # slp1 -> Counter(text index)
    lemma_ids = defaultdict(set)         # slp1 -> DCS lemma ids
    words_per_text = Counter()
    files = sorted((CONLLU / "files").rglob("*.conllu"))
    for n, path in enumerate(files):
        rel = unicodedata.normalize("NFC", str(path.relative_to(CONLLU / "files")))
        name, slot = chapters.get(rel, (path.parent.name, None))
        if name not in text_ids:
            text_ids[name] = len(texts)
            texts.append({"name": name, "slot": slot})
        t = text_ids[name]
        if texts[t]["slot"] is None and slot is not None:
            texts[t]["slot"] = slot
        with open(path, encoding="utf-8") as f:
            for line in f:
                if not line or line[0] in "#\n":
                    continue
                cols = line.rstrip("\n").split("\t")
                if len(cols) < 10 or "-" in cols[0] or "." in cols[0]:
                    continue
                lemma = cols[2]
                if not lemma or lemma == "_" or cols[3] == "PUNCT":
                    continue
                key = iast_to_slp1(lemma)
                counts[key][t] += 1
                words_per_text[t] += 1
                m = re.search(r"LemmaId=(\d+)", cols[9])
                if m:
                    lemma_ids[key].add(m.group(1))
        if n % 500 == 0:
            print(f"  {n}/{len(files)} chapters", file=sys.stderr)

    slot_words = [0] * 5
    slot_texts = [[] for _ in range(5)]
    for i, t in enumerate(texts):
        t["words"] = words_per_text[i]
        if t["slot"]:
            slot_words[t["slot"] - 1] += t["words"]
            slot_texts[t["slot"] - 1].append(t["name"])

    records = {}
    for key, c in counts.items():
        slots = [0] * 5
        for t, k in c.items():
            if texts[t]["slot"]:
                slots[texts[t]["slot"] - 1] += k
        info = [lexicon.get(i, ("", "")) for i in sorted(lemma_ids[key], key=int)]
        records[key] = {
            "n": sum(c.values()),
            "slots": slots,
            "texts": [[t, k] for t, k in c.most_common(15)],
            "textCount": len(c),
            "gram": "; ".join(sorted({g for g, _ in info if g})),
            "meanings": " | ".join(m for _, m in info if m)[:600],
        }

    try:
        commit = subprocess.run(["git", "-C", str(DCS), "rev-parse", "--short", "HEAD"],
                                capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        commit = "unknown"

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json.gz"):
        old.unlink()
    bounds = json.loads((ROOT / "site" / "data" / "sa" / "shards.json").read_text())[::8]
    sort_bounds = [slp1_sort_key(b) for b in bounds]
    shards = defaultdict(dict)
    for k, v in records.items():
        shards[max(0, bisect.bisect_right(sort_bounds, slp1_sort_key(k)) - 1)][k] = v
    for i, shard in shards.items():
        with gzip.open(OUT / f"{i}.json.gz", "wt", encoding="utf-8", compresslevel=9) as f:
            json.dump(shard, f, ensure_ascii=False, separators=(",", ":"))
    (OUT / "shards.json").write_text(json.dumps(bounds, ensure_ascii=False))
    meta = {
        "texts": texts, "slotWords": slot_words, "slotTexts": slot_texts,
        "totalWords": sum(words_per_text.values()), "commit": commit,
    }
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))
    print(f"corpus: {len(records)} lemmas, {meta['totalWords']} words, {len(texts)} texts, commit {commit}")


if __name__ == "__main__":
    main()
