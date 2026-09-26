import html
import json
import re
import time
import unicodedata
import urllib.request

from shapely.geometry import Point, shape

from common import WORK, write_json

BASE = "https://ekitan.com"
UA = "Mozilla/5.0 (compatible; tokyo-underground-map/1.0; +https://github.com/ayameya/Hg)"
CACHE = WORK / "ekitan"
DELAY = 1.0
_last = [0.0]


def fetch(path):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / (path.strip("/").replace("/", "_") + ".html")
    if f.exists():
        return f.read_text(encoding="utf-8")
    wait = DELAY - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA, "Accept-Language": "ja"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read().decode("utf-8", errors="replace")
            break
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** (attempt + 1))
    _last[0] = time.time()
    f.write_text(body, encoding="utf-8")
    return body


def norm(s):
    return unicodedata.normalize("NFKC", s).strip()


def station_names_in_wards():
    names = set()
    area = shape(json.loads((WORK / "wards_union.geojson").read_text())).buffer(0.01)
    with open(WORK / "layers" / "station.geojsonseq", encoding="utf-8") as f:
        for line in f:
            feat = json.loads(line)
            if area.contains(shape(feat["geometry"])):
                names.add(norm(feat["properties"]["name"]).removesuffix("駅"))
    return names


def base_name(s):
    return re.sub(r"[(（].*?[)）]$", "", norm(s)).removesuffix("駅")


def parse_exits(body):
    lat = re.search(r'lat\s*=\s*"([\d.]+)"', body)
    lon = re.search(r'lon\s*=\s*"([\d.]+)"', body)
    title = re.search(r"<h1[^>]*>(.*?)の出口</h1>", body)
    exits = []
    for m in re.finditer(r'<dt class="w130px">(.*?)</dt>', body, flags=re.S):
        block = m.group(1)
        note = re.search(r'<span class="exit-annotation">(.*?)</span>', block, flags=re.S)
        label = norm(html.unescape(re.sub(r"<.*", "", block, flags=re.S)))
        exits.append({"label": label, "note": norm(html.unescape(note.group(1))) if note else ""})
    return {
        "name": norm(html.unescape(title.group(1))) if title else "",
        "lat": float(lat.group(1)) if lat else None,
        "lon": float(lon.group(1)) if lon else None,
        "exits": exits,
    }


def main():
    targets = station_names_in_wards()
    area = shape(json.loads((WORK / "wards_union.geojson").read_text())).buffer(0.003)
    top = fetch("/sta-info/area/0")
    lines = sorted(set(re.findall(r'href="(/sta-info/line/\d+)"', top)))
    stations = {}
    for lp in lines:
        body = fetch(lp)
        for sid, name in re.findall(r'href="/sta-info/station/(\d+)"[^>]*><span class="inner-cell"><span class="text">([^<]+)', body):
            stations.setdefault(sid, norm(html.unescape(name)))
    cand = {sid: n for sid, n in stations.items() if base_name(n) in targets}
    print("lines", len(lines), "stations", len(stations), "candidates", len(cand))
    out = []
    for sid, name in sorted(cand.items()):
        info = parse_exits(fetch(f"/sta-info/station/{sid}/exit"))
        if info["lat"] is None or not area.contains(Point(info["lon"], info["lat"])):
            continue
        info["id"] = sid
        info["url"] = f"{BASE}/sta-info/station/{sid}/exit"
        out.append(info)
    write_json(WORK / "ekitan_exits.json", out)
    n_exits = sum(len(s["exits"]) for s in out)
    n_notes = sum(1 for s in out for e in s["exits"] if e["note"])
    print("stations in wards", len(out), "exits", n_exits, "with notes", n_notes)


if __name__ == "__main__":
    main()
