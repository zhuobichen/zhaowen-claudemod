# Regenerate moon-band/data/poems.txt from the chinese-poetry corpora.
#
# Fetch the sources first (the two directories below), then run this with the
# paths pointed at them. The output is what the mod reads with $.fs.read, which
# rejects anything over 4 MiB, so the cap is a hard requirement.
#
#   pip install opencc-python-reimplemented      # for the traditional source

import glob
import io
import json
import os
import re
import sys

SRC = r"D:\tmp\poetry"  # holds tang\poet.tang.*.json and ci\ci.song.*.json
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "moon-band", "data", "poems.txt")
CAP_BYTES = int(3.5 * 1024 * 1024)
TANG_KEPT = 30000

CJK = re.compile(r"^[\u4e00-\u9fff，。！？、；：]{8,32}$")


def source_of(author, title):
    author = (author or "").strip()
    title = (title or "").strip()
    if not author or not title:
        return None
    return "%s《%s》" % (author, title)


def take(paths, kind):
    seen = set()
    out = []
    for path in paths:
        try:
            with io.open(path, encoding="utf-8") as f:
                poems = json.load(f)
        except Exception as exc:
            sys.stderr.write("skip %s: %s\n" % (os.path.basename(path), exc))
            continue
        if not isinstance(poems, list):
            continue
        for poem in poems:
            if not isinstance(poem, dict):
                continue
            paragraphs = poem.get("paragraphs") or []
            if not paragraphs:
                continue
            line = str(paragraphs[0]).strip()
            if not CJK.match(line):
                continue
            src = source_of(poem.get("author"), poem.get("title") or poem.get("rhythmic"))
            if src is None or line in seen:
                continue
            seen.add(line)
            out.append("%s\t%s" % (line, src))
    sys.stderr.write("%s: %d entries\n" % (kind, len(out)))
    return out


tang = sorted(glob.glob(os.path.join(SRC, "tang", "poet.tang.*.json")))
song = sorted(glob.glob(os.path.join(SRC, "ci", "ci.song.*.json")))
sys.stderr.write("files: tang=%d song=%d\n" % (len(tang), len(song)))

tang_entries = take(tang, "tang")
song_entries = take(song, "ci")

try:
    from opencc import OpenCC

    to_simple = OpenCC("t2s").convert
    tang_entries = [to_simple(one) for one in tang_entries]
    sys.stderr.write("tang converted to simplified with OpenCC\n")
except Exception as exc:
    sys.stderr.write("OpenCC unavailable (%s): leaving tang traditional\n" % exc)

entries = tang_entries[:TANG_KEPT] + song_entries

body = "\n".join(entries) + "\n"
while len(body.encode("utf-8")) > CAP_BYTES and entries:
    entries = entries[: int(len(entries) * 0.95)]
    body = "\n".join(entries) + "\n"

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write(body)

size = len(body.encode("utf-8"))
sys.stderr.write("wrote %s: %d entries, %.2f MiB\n" % (OUT, len(entries), size / 1024.0 / 1024.0))
if size > 4 * 1024 * 1024:
    sys.stderr.write("TOO BIG for $.fs.read\n")
    sys.exit(1)
