"""Collect the rule texts that vidyut-prakriya cites in its derivations.

The TSV files come from vidyut's data release (data-src/vidyut/prakriya), which
sources them from ashtadhyayi.com under an MIT license. Output is keyed by the
`source` names used in wasm/src/lib.rs:

  site/data/grammar/rules.json  {source: {code: text}}
"""

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data-src" / "vidyut" / "prakriya"
OUT = ROOT / "site" / "data" / "grammar"

FILES = {
    "ashtadhyayi": "sutrapatha.tsv",
    "varttika": "varttikas.tsv",
    "unadipatha": "unadipatha.tsv",
    "linganushasana": "linganushasanam.tsv",
    "phit": "phit-sutras.tsv",
    "kashika": "kashika.tsv",
    "kaumudi": "kaumudi.tsv",
}


def main():
    rules = {}
    for source, name in FILES.items():
        with open(SRC / name, encoding="utf-8") as f:
            rules[source] = {row["code"]: row["text"] for row in csv.DictReader(f, delimiter="\t")}
    with open(SRC / "dhatupatha.tsv", encoding="utf-8") as f:
        rules["dhatupatha"] = {row["code"]: f'{row["dhatu"]} {row["artha"]}' for row in csv.DictReader(f, delimiter="\t")}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "rules.json").write_text(json.dumps(rules, ensure_ascii=False, separators=(",", ":")))
    print({k: len(v) for k, v in rules.items()})


if __name__ == "__main__":
    main()
