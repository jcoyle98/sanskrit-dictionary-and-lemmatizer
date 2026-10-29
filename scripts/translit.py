"""IAST to SLP1, for roots and lemmas that sources write in IAST (DCS, Burnouf, Lanman...)."""

import unicodedata

IAST_MULTI = [("ai", "E"), ("au", "O"), ("kh", "K"), ("gh", "G"), ("ch", "C"), ("jh", "J"), ("ṭh", "W"),
              ("ḍh", "Q"), ("th", "T"), ("dh", "D"), ("ph", "P"), ("bh", "B")]
IAST_SINGLE = {"ā": "A", "ī": "I", "ū": "U", "ṛ": "f", "ṝ": "F", "ḷ": "x", "ḹ": "X", "ṃ": "M", "ṁ": "M",
               "ḥ": "H", "ṅ": "N", "ñ": "Y", "ṭ": "w", "ḍ": "q", "ṇ": "R", "ś": "S", "ṣ": "z"}
ACCENTS = {"́", "̀", "̂"}  # acute, grave, circumflex
VOWEL_BASES = set("aeiourl")  # r and l carry the dot below of ṛ and ḷ


def strip_accents(s: str) -> str:
    """Remove Vedic accent marks (á, à, â) from vowels only: decomposed, ś is s plus the
    same combining acute, and it must stay."""
    out, base = [], ""
    for c in unicodedata.normalize("NFD", s):
        if unicodedata.combining(c):
            if c in ACCENTS and base in VOWEL_BASES:
                continue
        else:
            base = c
        out.append(c)
    return unicodedata.normalize("NFC", "".join(out))


def iast_to_slp1(s: str) -> str:
    s = strip_accents(s.lower())
    out, i = [], 0
    while i < len(s):
        for a, b in IAST_MULTI:
            if s.startswith(a, i):
                out.append(b)
                i += len(a)
                break
        else:
            out.append(IAST_SINGLE.get(s[i], s[i]))
            i += 1
    return "".join(out)
