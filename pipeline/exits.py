import json
import re
import unicodedata

from common import WORK

FIRST = "05:00"
LAST = "00:30"
DAYS = [
    (r"平日・土曜|平日・土", "Mo-Sa"),
    (r"土休日|土日祝|土・日・祝日|土・休日", "Sa,Su,PH"),
    (r"日・祝日|日祝|日曜・祝日|日・祝", "Su,PH"),
    (r"平日", "Mo-Fr"),
    (r"土曜|土", "Sa"),
    (r"日曜|日", "Su"),
    (r"祝日|祝", "PH"),
    (r"通常", ""),
]
TIME = r"(初電|始発|終電|終車|\d{1,2}:\d{2})"
WEEKDAY = {"月": "Mo", "火": "Tu", "水": "We", "木": "Th", "金": "Fr", "土": "Sa", "日": "Su"}


def nfkc(s):
    return unicodedata.normalize("NFKC", s or "").strip()


def hhmm(t, end=False):
    if t in ("初電", "始発"):
        return FIRST
    if t in ("終電", "終車"):
        return LAST
    h, m = t.split(":")
    return f"{int(h) % 24:02d}:{m}"


def span(text):
    m = re.search(TIME + r"\s*[-~〜]\s*" + TIME, text)
    if not m:
        return None
    return f"{hhmm(m.group(1))}-{hhmm(m.group(2), True)}"


def day_selector(label):
    for pat, sel in DAYS:
        if re.fullmatch(pat, label):
            return sel
    if label and all(ch in WEEKDAY for ch in label):
        return ",".join(WEEKDAY[ch] for ch in label)
    return None


def parse_note(note):
    s = nfkc(note).lstrip("※").strip()
    if not s:
        return None
    if re.fullmatch(r"閉鎖中?|終日閉鎖", s):
        return "off"
    rules = []
    segs = re.findall(r"\[([^\]]+)\]([^\[]*)", s)
    if segs:
        seen = set()
        base = span(s.split("[", 1)[0])
        for label, body in segs:
            if label in ("閉鎖",):
                continue
            sel = day_selector(label)
            if sel is None:
                continue
            closed = "閉鎖" in body and not span(body)
            val = "off" if closed else span(body)
            if val is None:
                continue
            if sel == "":
                base = val
            else:
                rules.append(f"{sel} {val}")
                seen.update(sel.split(","))
        if base:
            rules.insert(0, base)
        elif "Mo-Fr" in seen and "Sa" not in seen and ("Su" in seen or "PH" in seen):
            rules = [r.replace("Mo-Fr", "Mo-Sa") for r in rules]
        elif rules and not base:
            rules.append("PH off") if "PH" not in seen else None
        return "; ".join(rules) if rules else None
    val = span(s)
    if not val:
        return None
    rules.append(val)
    if re.search(r"土休日は?終日閉鎖|土休日閉鎖", s):
        rules.append("Sa,Su,PH off")
    elif re.search(r"日祝は?閉鎖|日・祝日は?閉鎖", s):
        rules.append("Su,PH off")
    return "; ".join(rules)


def norm_label(s, station=""):
    s = nfkc(s)
    if station:
        s = s.replace(station, "")
    s = re.sub(r"(駅|出入口|番出口|出口|番|口|のりば|改札)", "", s)
    s = re.sub(r"[\s()（）・/]", "", s)
    return s.lower()


def base_name(s):
    return re.sub(r"[(（].*?[)）]$", "", nfkc(s)).removesuffix("駅")


def load_rules():
    path = WORK / "ekitan_exits.json"
    if not path.exists():
        return [], {}
    rules = []
    stats = {"stations": 0, "exits": 0, "with_note": 0, "parsed": 0, "unparsed": []}
    for st in json.loads(path.read_text(encoding="utf-8")):
        stats["stations"] += 1
        name = base_name(st["name"])
        for e in st["exits"]:
            stats["exits"] += 1
            if not e["note"]:
                continue
            stats["with_note"] += 1
            oh = parse_note(e["note"])
            if not oh:
                stats["unparsed"].append(e["note"])
                continue
            stats["parsed"] += 1
            rules.append({
                "id": f"ekitan-{st['id']}-{e['label']}",
                "name": f"{name} {e['label']}",
                "center": [st["lon"], st["lat"]],
                "radius_m": 900,
                "label": norm_label(e["label"]),
                "station": name,
                "opening_hours": oh,
                "confidence": "medium",
                "source": st["url"],
                "note": f"駅探の出口情報「{e['note']}」。初電は5:00、終電は0:30として近似。",
            })
    return rules, stats


if __name__ == "__main__":
    rules, stats = load_rules()
    print({k: v for k, v in stats.items() if k != "unparsed"}, stats["unparsed"])
    for r in rules[:0]:
        print(r)
    import collections
    c = collections.Counter(r["opening_hours"] for r in rules)
    for k, v in c.most_common(80):
        print(v, k)
