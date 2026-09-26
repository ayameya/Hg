import json
import math
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIPE = ROOT / "pipeline"
WORK = Path(os.environ.get("WORK", "/home/user/data"))
OUT = ROOT / "docs" / "data"

BBOX = (139.45, 35.40, 140.05, 35.95)

WARDS = [
    "千代田区", "中央区", "港区", "新宿区", "文京区", "台東区", "墨田区", "江東区",
    "品川区", "目黒区", "大田区", "世田谷区", "渋谷区", "中野区", "杉並区", "豊島区",
    "北区", "荒川区", "板橋区", "練馬区", "足立区", "葛飾区", "江戸川区",
]

NUM = re.compile(r"-?\d+(?:\.\d+)?")
BASEMENT = re.compile(r"^B(\d+)F?$", re.I)


def parse_levels(value):
    if not value:
        return []
    out = []
    for part in value.replace(",", ";").split(";"):
        part = part.strip()
        m = BASEMENT.match(part)
        if m:
            out.append(-float(m.group(1)))
            continue
        out.extend(float(x) for x in NUM.findall(part))
    return out


def parse_layer(value):
    if not value:
        return None
    m = NUM.search(value)
    return float(m.group(0)) if m else None


def haversine(a, b):
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


def line_length(coords):
    return sum(haversine(coords[i], coords[i + 1]) for i in range(len(coords) - 1))


def r6(x):
    return round(x, 6)


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def write_geojsonseq(path, features):
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(path, "w", encoding="utf-8") as f:
        for feat in features:
            f.write(json.dumps(feat, ensure_ascii=False, separators=(",", ":")))
            f.write("\n")
            n += 1
    return n


def feature(geom, props):
    return {"type": "Feature", "geometry": geom, "properties": {k: v for k, v in props.items() if v is not None and v != ""}}
