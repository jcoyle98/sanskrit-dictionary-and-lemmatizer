"""Build the static dictionary index served by the web app.

Reads each Cologne XML file (opened read-only, never modified) and writes:

  site/data/dicts.json            dictionary metadata, in default display order
  site/data/<ns>/shards.json      first headword of each shard
  site/data/<ns>/<n>.json.gz      {headword: [[dict_index, raw_entry_line], ...]}
  site/data/<ns>/headwords.tsv.gz headword \t dict indexes, in alphabetical order

<ns> is "sa" for Sanskrit headwords (SLP1) and "en" for the English-Sanskrit
dictionaries. Each entry line is stored exactly as Cologne publishes it; any
formatting happens in the browser.

Ordering: SLP1 keys are sorted in Sanskrit alphabetical (varṇamālā) order, and
the same comparison is implemented in site/js/slp1.js so the client can binary
search the shard list.
"""

import gzip
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data-src" / "cdsl"
OUT = ROOT / "site" / "data"

ENGLISH_HEADWORDS = {"AE", "MWE", "BOR"}
SHARD_BYTES = 400_000

# Sanskrit alphabetical order of SLP1 characters.
SLP1_ORDER = "aAiIuUfFxXeEoOMHkKgGNcCjJYwWqQRtTdDnpPbBmyrlvSzsh"
RANK = {c: i for i, c in enumerate(SLP1_ORDER)}

ENTRY_RE = re.compile(
    r"^<(H[^>]*)><h><key1>(?P<key1>.*?)</key1><key2>(?P<key2>.*?)</key2>.*?"
    r"<L>(?P<L>[^<]*)</L>(?:<pc>(?P<pc>[^<]*)</pc>)?"
)


def slp1_sort_key(s: str):
    # Characters outside the alphabet sort after it, by code point.
    return [RANK.get(c, 100 + ord(c)) for c in s]


def english_sort_key(s: str):
    return (s.lower(), s)


def read_entries(code: str):
    path = SRC / code.lower() / "xml" / f"{code.lower()}.xml"
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.startswith("<H"):
                continue
            m = ENTRY_RE.match(line)
            if not m:
                print(f"  {code}: unparsed line: {line[:80]!r}", file=sys.stderr)
                continue
            yield m.group("key1"), m.group("L"), line.rstrip("\n")


def read_bibliography(code: str):
    """Bibliographic data for the original print edition, from Cologne's header file."""
    path = SRC / code.lower() / "xml" / f"{code.lower()}header.xml"
    text = path.read_text(encoding="utf-8")
    m = re.search(r'<biblStruct type="original".*?</biblStruct>', text, re.S)
    block = m.group(0) if m else ""

    def all_of(tag):
        found = re.findall(rf"<{tag}[^>]*>(.*?)</{tag}>", block, re.S)
        return [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", x)).strip() for x in found]

    titles = all_of("title")
    dates = all_of("date")
    year = re.search(r"\d{4}", dates[0]) if dates else None
    key = re.search(r'<title type="key">([^<]*)</title>', text)
    avail = re.search(r"<availability[^>]*>(.*?)</availability>", text, re.S)
    avail = avail.group(1) if avail else ""
    paras = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", p)).strip() for p in re.findall(r"<p>(.*?)</p>", avail, re.S)]
    licence = re.search(r'target="([^"]*creativecommons[^"]*?)(?:/legalcode)?"', avail)
    return {
        "authors": all_of("author") or all_of("editor"),
        "book_title": titles[0] if titles else "",
        "subtitle": titles[1] if len(titles) > 1 else "",
        "place": ", ".join(all_of("pubPlace")),
        "publisher": ", ".join(all_of("publisher")),
        "date": dates[0] if dates else "",
        "pub": int(year.group(0)) if year else None,
        "cologne_key": key.group(1).strip() if key else "",
        # Cologne asks that credit be given exactly as stated in each header.
        "rights": paras,
        "licence": ("https:" + licence.group(1) if licence and licence.group(1).startswith("//") else licence.group(1)) if licence else "",
    }


def write_namespace(ns: str, entries: dict, sort_key):
    out = OUT / ns
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.json.gz"):
        old.unlink()

    keys = sorted(entries, key=sort_key)
    shards, shard, size = [], {}, 0
    firsts = []

    def flush():
        nonlocal shard, size
        if not shard:
            return
        n = len(shards)
        with gzip.open(out / f"{n}.json.gz", "wt", encoding="utf-8", compresslevel=9) as f:
            json.dump(shard, f, ensure_ascii=False, separators=(",", ":"))
        shards.append(n)
        shard, size = {}, 0

    for k in keys:
        if size >= SHARD_BYTES:
            flush()
        if not shard:
            firsts.append(k)
        shard[k] = entries[k]
        size += sum(len(raw) for _, raw in entries[k])
    flush()

    (out / "shards.json").write_text(json.dumps(firsts, ensure_ascii=False))
    with gzip.open(out / "headwords.tsv.gz", "wt", encoding="utf-8", compresslevel=9) as f:
        for k in keys:
            ds = sorted({d for d, _ in entries[k]})
            f.write(k + "\t" + ",".join(map(str, ds)) + "\n")
    print(f"{ns}: {len(keys)} headwords in {len(shards)} shards")


def main():
    dicts = json.loads((ROOT / "scripts" / "dicts.json").read_text())
    ns_entries = {"sa": defaultdict(list), "en": defaultdict(list)}
    meta = []
    for i, d in enumerate(dicts):
        code = d["code"]
        ns = "en" if code in ENGLISH_HEADWORDS else "sa"
        n = 0
        for key1, _, raw in read_entries(code):
            ns_entries[ns][key1].append([i, raw])
            n += 1
        meta.append({**d, "ns": ns, "entries": n, "bib": read_bibliography(code)})
        print(f"{code:6} {n:7} entries")

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "dicts.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    write_namespace("sa", ns_entries["sa"], slp1_sort_key)
    write_namespace("en", ns_entries["en"], english_sort_key)


if __name__ == "__main__":
    main()
