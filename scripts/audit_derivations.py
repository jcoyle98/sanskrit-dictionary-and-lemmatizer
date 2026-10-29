"""Audit the derivation readers in derivations.py over every entry.

For each dictionary: how many entries carry a derivation cue, how many proposals
were read, how many were dropped (and why), plus random samples of accepted
proposals, dropped proposals and cue-bearing entries where nothing was read.

  python3 scripts/audit_derivations.py [CODE ...] [--samples N]
"""

import gzip
import random
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import derivations  # noqa: E402
from build_dicts import read_entries  # noqa: E402

CUES = {
    "MW": r"<ab>fr\.</ab>\s*(?:√|<s>)",
    "PWG": r"^\s*<s>[^<]*</s>[^(]{0,40}\(von ",
    "PW": r"^\s*<s>[^<]*</s>[^(]{0,40}\(von ",
    "BOP": r"\(r\. <s>",
    "WIL": r"<ab>E\.</ab>",
    "AP90": r"\[<s>",
    "AP": r"\[<s>",
    "BUR": r"^\s*<s>[^<]*</s>\s*<i>[^<]*</i>\s*(?:<ab>[^<]*</ab>\s*)*<i>\(",
    "MD": r"\[√",
    "LAN": r"√",
    "GRA": r"Wurzel|Ableitung|abzuleiten|stammt",
    "BEN": r"\((?:[a-z ]{0,20})(?:from|i\. e\.) <i>",
}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    n = int(next((a.split("=")[1] for a in sys.argv if a.startswith("--samples=")), 12))
    codes = [a.upper() for a in args] or list(derivations.READERS)
    headwords = set()
    with gzip.open(ROOT / "site" / "data" / "sa" / "headwords.tsv.gz", "rt", encoding="utf-8") as f:
        for line in f:
            headwords.add(line.split("\t", 1)[0])
    rng = random.Random(7)
    for code in codes:
        reader = derivations.READERS[code]
        cue = re.compile(CUES[code])
        stats = Counter()
        accepted, dropped, missed = [], [], []
        for key1, L, raw in read_entries(code):
            body = re.search(r"<body>(.*)</body>", raw, re.S)
            body = body.group(1) if body else ""
            stats["entries"] += 1
            has_cue = bool(cue.search(body))
            stats["with cue"] += has_cue
            props = reader(body)
            ok = False
            for p in props:
                if not p["base"]:
                    reason = "empty"
                elif p["base"] == key1:
                    reason = "self"
                elif not derivations.resolve(p["base"], headwords, p.get("root_hint")):
                    reason = "not a headword"
                else:
                    reason = None
                    p["base"] = derivations.resolve(p["base"], headwords, p.get("root_hint"))
                if reason:
                    stats["dropped: " + reason] += 1
                    dropped.append((key1, L, p["base"], reason, p["quote"]))
                else:
                    ok = True
                    stats["accepted"] += 1
                    accepted.append((key1, L, p))
            if has_cue and not ok:
                stats["cue, nothing accepted"] += 1
                missed.append((key1, L, derivations.flat(body)[:220]))
        print(f"\n######## {code}  " + "  ".join(f"{k}={v}" for k, v in stats.items()))
        print("-- accepted (sample)")
        for key1, L, p in rng.sample(accepted, min(n, len(accepted))):
            extra = " ".join(x for x in (f"+{p['affix']}" if p["affix"] else "", f"pre={p['prefixes']}" if p["prefixes"] else "",
                                         f"q={p['qual']}" if p["qual"] else "", f"src={p['source']}" if p["source"] else "") if x)
            print(f"  {key1:18} <- {p['base']:12} {extra:30} | {p['quote'][:110]}")
        print("-- dropped (sample)")
        for key1, L, base, reason, q in rng.sample(dropped, min(n // 2, len(dropped))):
            print(f"  {key1:18} <- {base:12} [{reason}] | {q[:110]}")
        print("-- cue but nothing accepted (sample)")
        for key1, L, t in rng.sample(missed, min(n // 2, len(missed))):
            print(f"  {key1:18} L{L} | {t}")


if __name__ == "__main__":
    main()
