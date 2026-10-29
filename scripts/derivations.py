"""Derivations proposed in the dictionaries' own prose, for build_etym.py.

Each dictionary states derivations its own way; these patterns read them:

  MW    "(fr. √ ind)", "according to <ls>BRD.</ls> fr. √ inv", "more probably from √ ind"
  PWG   "(von <s>Dar</s>)" right after the headword (also PW)
  BOP   "(r. <s>ind</s> s. <s>ra</s>)"  radix + suffix
  WIL   "E. <s>aMSa</s> to divide, <s>ac</s> affix"
  AP90  "[<s>div-ac</s>]" (also AP)
  BUR   "<i>indra</i> <ab>m.</ab> <i>(ind)</i>" root in parentheses after the headword
  MD    "[√ yuj]"
  LAN   "[… √am …]" in the closing bracketed note
  GRA   "… von der Wurzel indh …"
  BEN   "(probably from <i>añj</i> …)", "i. e. <i>yuj + a</i>"

Every proposal keeps the clause it came from. Statements that a derivation is
uncertain ("none of the numerous proposed derivations is satisfactory", "Die
Ableitung ist sehr unsicher") are collected separately.
"""

import re

from translit import iast_to_slp1

UPASARGAS = {"pra", "parA", "apa", "sam", "anu", "ava", "nis", "nir", "dus", "dur", "vi", "AN", "A", "ni",
             "aDi", "api", "ati", "su", "ud", "ut", "aBi", "prati", "pari", "upa"}
QUALIFIERS = re.compile(
    r"(?i)\b(not|said to be|artificially formed|corrupted|fictitiously|nisi|vel|oder|or|"
    r"more probably|most probably|probably|prob\.|perhaps|possibly|rather|doubtful|"
    r"wahrscheinlichste|wahrscheinlich|wol|wohl|vielleicht|unsicher|"
    r"peut-être|probablement)\b|\?")
IAST_WORD = r"[a-zāīūṛṝḷṅñṭḍṇśṣṃḥ]+"

ASSESSMENT = re.compile(
    r"(?i)(none of the [^.;\]]*?derivations?[^.;\]]*"
    r"|no (?:satisfactory|certain) (?:derivation|etymology)[^.;\]]*"
    r"|(?:of )?(?:doubtful|uncertain|obscure|unknown|dubious) (?:origin|derivation|etymology)"
    r"|(?:origin|derivation|etymology) (?:is )?(?:doubtful|uncertain|obscure|unknown|dubious)"
    r"|Ableitung (?:ist )?(?:sehr |ganz |noch )?(?:unsicher|dunkel|zweifelhaft)"
    r"|(?:Herkunft|Etymologie|Ursprung) (?:ist )?(?:sehr )?(?:unsicher|dunkel|unbekannt|zweifelhaft)"
    r"|dunkle[rn]? (?:Herkunft|Ursprungs|Ableitung)"
    r"|étymologie (?:incertaine|obscure|douteuse)|origine (?:incertaine|obscure|inconnue))")


def flat(xml: str) -> str:
    """Entry markup as plain text, with SLP1 kept in ⟦…⟧ so the page can transliterate it."""
    t = re.sub(r"<s>(.*?)</s>", lambda m: "⟦" + re.sub(r"<[^>]+>", "", m.group(1)) + "⟧", xml, flags=re.S)
    t = re.sub(r'<lang n="greek">(.*?)</lang>', r"\1", t)
    t = re.sub(r"<(?:div|lb|br)[^>]*>", " ", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("&amp;", "&")
    return re.sub(r"\s+", " ", t).strip()


def clean_slp1(s: str) -> str:
    """One SLP1 word: accents, numbers, punctuation and compound hyphens removed.
    For "A, B" (alternatives or a root and its present form) the first is kept."""
    s = re.sub(r"<[^>]+>", "", s)
    s = re.split(r"[,=]|\s—\s", s)[0]
    s = re.sub(r"[/\\^˚°\d.;:!?()\[\]'\"]", "", s)
    s = s.strip(" -+")
    return s.replace("-", "") if " " not in s.strip() else s.split()[0].replace("-", "")


def split_plus(s: str):
    """"vi + nf" -> (["vi"], "nf"); "uzwra + kARqa" -> ([], "uzwra") with members kept by the caller."""
    parts = [clean_slp1(p) for p in re.sub(r"<[^>]+>", "", s).split("+") if clean_slp1(p)]
    pre = []
    while len(parts) > 1 and parts[0] in UPASARGAS:
        pre.append(parts.pop(0))
    return pre, parts


def qualifier(text: str) -> str:
    found = [m.group(0).lower() for m in QUALIFIERS.finditer(text)]
    return found[-1] if found else ""


def proposal(base, *, affix="", prefixes=(), kind="root", qual="", source="", clause=""):
    return {"base": base, "affix": affix, "prefixes": list(prefixes), "kind": kind,
            "qual": qual, "source": source, "quote": flat(clause)[:300]}


NASAL = {**dict.fromkeys("kKgG", "N"), **dict.fromkeys("cCjJ", "Y"), **dict.fromkeys("wWqQ", "R"),
         **dict.fromkeys("tTdD", "n"), **dict.fromkeys("pPbB", "m")}


def resolve(base: str, headwords, root_hint=False):
    """The headword a proposed base refers to, allowing for spelling conventions:
    anusvāra for a class nasal (Apte's aMj = aYj), and Wilson's roots cited with a
    final -a (kaSa "to hurt" = kaS). Returns None if nothing matches."""
    if not base:
        return None
    candidates = [base, re.sub(r"M(?=[kKgGcCjJwWqQtTdDpPbB])", lambda m: "", base)]
    candidates[1] = re.sub(r"M([kKgGcCjJwWqQtTdDpPbB])", lambda m: NASAL[m.group(1)] + m.group(1), base)
    if root_hint and base.endswith("a"):
        candidates += [base[:-1], candidates[1][:-1]]
    for c in candidates:
        if c in headwords:
            return c
    return None


# German words that can follow "von" or "Wurzel" in Grassmann's prose; some ("im", "an")
# are also Sanskrit headwords, so they must not be read as roots.
GERMAN_FUNCTION_WORDS = {"der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "ist", "und", "im",
                         "in", "an", "als", "zu", "mit", "aus", "von", "auf", "bei", "nach", "so"}


# ---- per-dictionary readers ---------------------------------------------------------------

MW_FROM = re.compile(
    r"(?P<pre>[^;()\[\]]{0,200}?)(?:<ab>fr\.</ab>|\bfrom)\s*"
    r"(?:(?:<hom>\d\.</hom>\s*)?<s>(?P<w>[^<]+)</s>\s*\+\s*)?"
    r"(?P<root>√\s*)?(?:<hom>\d\.</hom>\s*|\d\.\s*)?<s>(?P<b>[^<]+)</s>"
    r"(?:\s*(?P<rootafter>√)\s*(?:\d\.\s*)?<s>(?P<r2>[^<]+)</s>)?")


def mw(body):
    out = []
    # Only the opening parenthesis/bracket groups discuss etymology; later ones are senses.
    head = body[:900]
    for m in MW_FROM.finditer(head):
        pre = m.group("pre")
        src = re.search(r"(?:according|accord\.|acc\.)(?:</ab>)?\s*to\s*((?:<ls>[^<]*</ls>[\s,]*)+|[A-Z][\w.]+)", pre)
        source = flat(src.group(1)).strip(" ,") if src else ""
        b = m.group("b")
        if "√" in b:
            # "⟦saM-√ cit⟧": prefix and root inside one Sanskrit span.
            b = " + ".join(x.strip(" -") for x in b.split("√"))
        if m.group("rootafter"):
            # "fr. ⟦saM-⟧√ ⟦cit⟧": a prefix written before the root sign.
            b = f"{b.rstrip('-')} + {m.group('r2')}"
        pre_words, parts = split_plus(b)
        if not parts:
            continue
        prefixes = ([clean_slp1(m.group("w"))] if m.group("w") else []) + pre_words
        out.append(proposal(parts[0], affix="+".join(parts[1:]), prefixes=prefixes,
                            kind="root" if m.group("root") or m.group("rootafter") or "√" in m.group("b") else "base",
                            qual=qualifier(pre[-40:]), source=source, clause=m.group(0)))
    return out


def pwg(body):
    """"(von 1. ⟦ran⟧ mit ⟦vi⟧)", "(von ⟦uzwra⟧ + ⟦kARqa⟧)", "(von ⟦mad, mand⟧)"."""
    m = re.match(r"\s*<s>[^<]*</s>[^(]{0,80}?\(von\s+(?:<hom>\d\.</hom>\s*|\d\.\s*)?<s>([^<]+)</s>([^)]{0,160})\)", body)
    if not m:
        return []
    rest = m.group(2)
    prefixes = [clean_slp1(x) for x in re.findall(r"mit\s+(?:<hom>\d\.</hom>\s*)?<s>([^<]+)</s>", rest)]
    members = [clean_slp1(x) for x in re.findall(r"^\s*\+\s*(?:<hom>\d\.</hom>\s*)?<s>([^<]+)</s>", rest)]
    return [proposal(clean_slp1(m.group(1)), affix="+".join(members), prefixes=prefixes, kind="base",
                     qual=qualifier(re.sub(r"<s>.*?</s>", "", rest)), clause=m.group(0))]


def bop(body):
    """"(r. ⟦tud⟧ praef. ⟦pra⟧ s. ⟦a⟧)"; "nisi" (unless) introduces an alternative."""
    out = []
    for m in re.finditer(r"\(r\.\s*<s>([^<]+)</s>((?:[^()]|\([^()]*\)){0,300})\)", body[:900]):
        rest = m.group(2).split("nisi")[0]
        prefixes = [clean_slp1(x) for x in re.findall(r"praef\.\s*<s>([^<]+)</s>", rest)]
        suffix = re.search(r"\bs(?:uff)?\.\s*<s>([^<]+)</s>", rest)
        out.append(proposal(clean_slp1(m.group(1)), affix=clean_slp1(suffix.group(1)) if suffix else "",
                            prefixes=prefixes, qual="nisi" if "nisi" in m.group(2) else "", clause=m.group(0)))
    return out


def wil(body):
    """"E. ⟦pra, kaSa⟧ to hurt, aff. ⟦ac⟧" / "E. ⟦aBi⟧ before ⟦ama⟧ to be sick, and the affix ⟦kta⟧"."""
    m = re.search(r"<ab>E\.</ab>(.*?)(?:</div>|</body>|$)", body, re.S)
    if not m:
        return []
    # Abbreviations such as <ab>neg.</ab> and <ab>aff.</ab> are read as text.
    formula = re.sub(r"</?(?:ab|i|lex|b)(?:\s[^>]*)?>", "", m.group(1))
    tokens = []
    for t in re.finditer(r"([^<]{0,25})<s>([^<]+)</s>\s*([^<]{0,30})", formula):
        words = [w for w in (clean_slp1(x) for x in t.group(2).split(",")) if w]
        for j, w in enumerate(words):
            last = j == len(words) - 1
            tokens.append((w, t.group(1).lower() if j == 0 else "", t.group(3).lower() if last else ""))
    base, affix, prefixes, gloss = "", "", [], ""
    for word, before, after in tokens:
        if re.search(r"aff(?:ix)?\.?\s*$|affix(?:es)?\s*$", before) or re.match(r"\s*(?:and\s+)?(?:\w+\s+)?aff", after):
            affix = affix or word
        elif not base and (re.match(r"\s*(?:neg|priv|particle|prefix)", after) or word in UPASARGAS or re.match(r"\s*(?:and\s+\w+\s+)?before", after)):
            prefixes.append(word)
        elif not base:
            base, gloss = word, after
    if not base:
        return []
    p = proposal(base, affix=affix, prefixes=prefixes, kind="base", clause="E." + formula)
    # "kaSa to hurt": a root, cited with a final -a.
    p["root_hint"] = gloss.strip().startswith("to ")
    return [p]


def ap90(body):
    """"[⟦div-ac⟧]", "[⟦saMj -kiTan⟧ Uṇ. 3. 154]", "[⟦na-jIv-ani⟧ P. III. 3. 112]".
    Brackets that are glosses rather than root-affix formulas are skipped."""
    m = re.search(r"\[<s>([^<]{1,60})</s>", body[:500])
    if not m:
        return []
    first = m.group(1).split(";")[-1].strip()
    if not re.match(r"[^\s-]+\s*-", first):
        return []
    parts = [clean_slp1(p) for p in re.split(r"[-\s+]+", first) if clean_slp1(p)]
    prefixes = []
    while len(parts) > 1 and (parts[0] in UPASARGAS or parts[0] in ("na", "a", "an")):
        prefixes.append(parts.pop(0))
    if not parts:
        return []
    return [proposal(parts[0], affix="-".join(parts[1:]), prefixes=prefixes, clause=m.group(0) + "]")]


def bur(body):
    """"<i>indra</i> <ab>m.</ab> <i>(ind)</i>", "(ut; sah)", "(gai; sfx. aka)", "(a-sat-jana)", "(c. de ram)"."""
    m = re.match(r"\s*<s>[^<]*</s>\s*<i>[^<]*</i>\s*(?:<ab>[^<]*</ab>\s*)*(?:<i>)?\(((?:[^()<]|<[^>]+>){1,140}?)\)", body)
    if not m:
        return []
    inner = re.sub(r"<[^>]+>", "", m.group(1))
    # "c. de ram", "dés. de kit": causative / desiderative (also intensive, denominative) of a root.
    inner = re.sub(r"(?<![\w.])(?:c|dés|int|intens|fréq|dén|dénom)\.\s*(?:de\s+|d')?", "", inner)
    suffix = re.search(r"sfx\.\s*(" + IAST_WORD + r")", inner)
    words = []
    for part in inner.split(";"):
        part = part.strip()
        if not part or part.startswith("sfx"):
            continue
        # First IAST word of each part (glosses and class numbers follow it); hyphens join members.
        first = re.match(IAST_WORD + r"(?:-" + IAST_WORD + r")*", part)
        if first:
            words += [iast_to_slp1(w) for w in first.group(0).split("-")]
    prefixes = []
    while len(words) > 1 and (words[0] in UPASARGAS or words[0] in ("a", "an", "ut")):
        prefixes.append(words.pop(0))
    if not words or words[0] in ("a", "an") or (len(words) == 1 and words[0] in UPASARGAS):
        return []
    affix = "+".join(([iast_to_slp1(suffix.group(1))] if suffix else []) + words[1:])
    return [proposal(words[0], affix=affix, prefixes=prefixes, kind="base", clause=m.group(0))]


def md(body):
    out = []
    for m in re.finditer(r"\[√\s*(?:<hom>\d\.</hom>\s*)?(" + IAST_WORD + r")[^\]]{0,30}\]", body[:600]):
        out.append(proposal(iast_to_slp1(m.group(1)), clause=m.group(0)))
    return out


def lan(body):
    notes = re.findall(r"\[([^\[\]]{0,400})\]", body)
    if not notes:
        return []
    note = notes[-1]
    out = []
    for m in re.finditer(r"√\s?\d?(" + IAST_WORD + r")", flat(note)):
        out.append(proposal(iast_to_slp1(m.group(1)), qual=qualifier(note[:m.start() + 20]), clause=note))
    return out


def gra(body):
    head = body.split('<div n="H">')[0]
    out = []
    for sent in re.split(r"(?<=[.;])\s+", flat(head)):
        if not re.search(r"Ableitung|Wurzel|stammt|abzuleiten|abgeleitet", sent):
            continue
        for m in re.finditer(r"(?:Wurzel|von)\s+(" + IAST_WORD + r")", sent):
            w = m.group(1)
            if w in GERMAN_FUNCTION_WORDS:
                continue
            out.append(proposal(iast_to_slp1(w), qual=qualifier(sent), clause=sent))
    return out


def ben(body):
    out = []
    for m in re.finditer(r"(?P<pre>\((?:[a-z ]{0,20}))(?:from|i\. e\.)\s*(?:<i>([^<]+)</i>|(" + IAST_WORD + r"(?:\s*\+\s*" + IAST_WORD + r")?))", body[:500]):
        parts = [p.strip() for p in (m.group(2) or m.group(3)).split("+")]
        base = iast_to_slp1(parts[0].strip("√ -"))
        affix = iast_to_slp1(parts[1]) if len(parts) > 1 else ""
        out.append(proposal(base, affix=affix, kind="base", qual=qualifier(m.group("pre")), clause=m.group(0) + ")"))
    return out


READERS = {"MW": mw, "PWG": pwg, "PW": pwg, "BOP": bop, "WIL": wil, "AP90": ap90, "AP": ap90,
           "BUR": bur, "MD": md, "LAN": lan, "GRA": gra, "BEN": ben}
ASSESS_IN = ["MW", "MW72", "LAN", "GRA", "PWG", "PW", "BEN", "MD", "BUR", "CAE", "CCS", "BOP", "AP90", "STC"]


def assessments(body, code=""):
    """Statements that a word's derivation is uncertain. "Of unknown origin" can also be a
    word's meaning (kutastya, "coming from whence?"), so: in MW and Lanman the statement must
    sit inside the parenthesis or bracket where they discuss etymology; elsewhere it must name
    the derivation or etymology itself (Grassmann's prose is all etymology and is kept)."""
    text = flat(body)
    out = []
    for m in ASSESSMENT.finditer(text):
        before = text[:m.start()]
        depth = before.count("(") - before.count(")") + before.count("[") - before.count("]")
        if code in ("MW", "MW72", "LAN") and depth <= 0:
            continue
        if code not in ("MW", "MW72", "LAN", "GRA") and not re.search(r"(?i)deriv|etym|Ableitung", m.group(0)):
            continue
        a = max(text.rfind(".", 0, m.start()), text.rfind(";", 0, m.start()), text.rfind("[", 0, m.start()),
                text.rfind("(", 0, m.start()))
        b = min([i for i in (text.find(".", m.end()), text.find(";", m.end()), text.find("]", m.end()))
                 if i != -1] or [len(text)])
        out.append(text[a + 1:b + 1].strip()[:300])
    return out
