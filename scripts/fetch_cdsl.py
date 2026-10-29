"""Download the Cologne Digital Sanskrit Lexicon (CDSL) dictionaries.

Each dictionary is fetched as the XML archive Cologne publishes on its
download pages (scans/<CODE>Scan/<year>/downloads/<code>xml.zip), unpacked
into data-src/cdsl/<code>/, and then made read-only. Nothing downstream ever
writes to these files; the build only opens them for reading.

Also fetches the etymology tables Cologne publishes in csl-orig.

Usage: python3 scripts/fetch_cdsl.py [CODE ...]
"""

import json
import os
import stat
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data-src" / "cdsl"
BASE = "https://www.sanskrit-lexicon.uni-koeln.de/scans"
USER_AGENT = "sanskrit-dictionary-and-lemmatizer/0.1 (+https://github.com/jcoyle98/sanskrit-dictionary-and-lemmatizer)"
CSL_ORIG = "https://raw.githubusercontent.com/sanskrit-lexicon/csl-orig/master/v02"

# Etymology extractions published alongside the dictionary sources.
CSL_ORIG_FILES = [
    "etymology_stats/root_oracle.tsv",
    "etymology_stats/README.md",
    "mw/mw_etymology.tsv",
    "mw/README_etymology.md",
    "mw/mw_roots.tsv",
]


def make_read_only(path: Path):
    for p in [path, *path.rglob("*")]:
        mode = p.stat().st_mode
        p.chmod(mode & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))


def make_writable(path: Path):
    for p in [path, *path.rglob("*")]:
        p.chmod(p.stat().st_mode | stat.S_IWUSR)


def download(url: str, dest: Path, attempts: int = 4):
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for i in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            tmp.rename(dest)
            return
        except (urllib.error.URLError, TimeoutError) as e:
            if i == attempts - 1:
                raise
            print(f"  retrying after {e}")
            time.sleep(5 * (i + 1))


def fetch_dict(d):
    code = d["code"].lower()
    dest = OUT / code
    if (dest / "xml" / f"{code}.xml").exists():
        print(f"{d['code']:6} already present")
        return
    if dest.exists():
        make_writable(dest)
    dest.mkdir(parents=True, exist_ok=True)
    url = f"{BASE}/{d['code']}Scan/{d['year']}/downloads/{code}xml.zip"
    zpath = dest / f"{code}xml.zip"
    print(f"{d['code']:6} {url}")
    download(url, zpath)
    with zipfile.ZipFile(zpath) as z:
        for name in z.namelist():
            # Refuse entries that would escape the destination directory.
            target = (dest / name).resolve()
            if not str(target).startswith(str(dest.resolve()) + os.sep):
                raise RuntimeError(f"unsafe path in {zpath}: {name}")
        z.extractall(dest)
    make_read_only(dest)


def fetch_csl_orig():
    dest = OUT / "csl-orig"
    dest.mkdir(parents=True, exist_ok=True)
    for rel in CSL_ORIG_FILES:
        target = dest / rel.replace("/", "__")
        if target.exists():
            continue
        print(f"csl-orig {rel}")
        download(f"{CSL_ORIG}/{rel}", target)
        make_read_only(target)


def main():
    dicts = json.loads((ROOT / "scripts" / "dicts.json").read_text())
    wanted = {c.upper() for c in sys.argv[1:]}
    for d in dicts:
        if not wanted or d["code"] in wanted:
            fetch_dict(d)
    if not wanted:
        fetch_csl_orig()


if __name__ == "__main__":
    main()
