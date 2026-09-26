import json
import re
import subprocess
import unicodedata
from collections import defaultdict

import shapely
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

from common import WORK, feature, write_geojsonseq, write_json

KSJ = WORK / "ksj"
SRC = WORK / "tokyo.osm.pbf"

GROUPS = {
    "national": ("国の機関", 13),
    "tokyo": ("都の機関・都立施設", 13),
    "ward": ("区の施設", 14),
    "police": ("警察署・交番", 14),
    "fire": ("消防署", 14),
    "post": ("郵便局", 14),
    "culture": ("図書館・博物館・美術館", 13),
    "sports": ("スポーツ施設", 15),
    "school": ("学校", 15),
    "medical": ("病院", 14),
    "welfare": ("福祉施設・保育所", 16),
    "toilet": ("公衆トイレ", 15),
    "park": ("公園", 14),
    "embassy": ("大使館・領事館", 13),
    "other": ("その他の公的機関", 15),
}

WARD_NAME = re.compile(r"(区立|区役所|区民|出張所|区総合庁舎|地域センター|区民センター|区民会館|区民館|保健所|保健センター|児童館|清掃事務所|区議会)")
TOKYO_NAME = re.compile(r"(^東京都(?!.{1,5}[区市町村]立)|^都立|^都営|東京都庁|都庁|都税事務所|警視庁|東京消防庁|東京都水道局|東京都下水道局|東京都交通局|東京都建設局|東京都港湾局|建設事務所)")
NATIONAL_NAME = re.compile(
    r"(省|庁(?!舎)|国会|議員会館|内閣|裁判所|検察庁|法務局|税務署|国税|税関|労働基準監督署|公共職業安定所|ハローワーク|"
    r"出入国|気象|宮内|自衛隊|防衛|海上保安|人事院|会計検査院|迎賓館|国立|独立行政法人|年金事務所|運輸支局|検疫所|"
    r"日本銀行|国土地理院|特許|拘置所|刑務所|少年院|地方整備局|国道事務所|河川事務所|財務局|首相官邸)"
)
FOOD = {"toilets"}


def nfkc(s):
    return unicodedata.normalize("NFKC", s or "").strip()


def key_name(s):
    s = nfkc(s)
    s = re.sub(r"[\s・()（）「」『』]", "", s)
    s = re.sub(r"^(東京都|独立行政法人|国立研究開発法人|一般財団法人|公益財団法人|社会福祉法人|医療法人社団|医療法人|学校法人)", "", s)
    return s


def similar(a, b):
    a, b = key_name(a), key_name(b)
    if not a or not b:
        return False
    if a in b or b in a:
        return True
    ga = {a[i:i + 2] for i in range(len(a) - 1)}
    gb = {b[i:i + 2] for i in range(len(b) - 1)}
    if not ga or not gb:
        return False
    return len(ga & gb) / len(ga | gb) >= 0.5


def admin_from_name(name, op=""):
    text = nfkc(name) + " " + nfkc(op)
    if WARD_NAME.search(text) and not re.search(r"(都立|国立)", text):
        return "区"
    if TOKYO_NAME.search(text) or nfkc(op).startswith("東京都") and not re.match(r"^東京都\S{1,5}[区市]", nfkc(op)):
        return "都"
    if NATIONAL_NAME.search(text):
        return "国"
    return ""


def classify_osm(p):
    name = p.get("name") or ""
    op = p.get("operator") or ""
    amenity = p.get("amenity")
    office = p.get("office")
    tourism = p.get("tourism")
    leisure = p.get("leisure")
    admin = admin_from_name(name, op)
    if amenity == "embassy" or office == "diplomatic" or p.get("diplomatic"):
        return "embassy", p.get("diplomatic") or "embassy", "外国"
    if amenity == "police":
        return "police", "koban" if (p.get("police") == "koban" or re.search(r"(交番|駐在所|派出所)", name)) else "station", "都"
    if amenity == "fire_station":
        return "fire", "fire_station", "都"
    if amenity == "post_office":
        return "post", "post_office", "公的"
    if amenity == "toilets":
        if p.get("access") in ("private", "customers", "no"):
            return None
        return "toilet", "toilets", admin or "公的"
    if amenity in ("library",) or tourism in ("museum", "gallery", "aquarium", "zoo") or amenity in ("arts_centre", "theatre", "planetarium", "concert_hall"):
        return "culture", amenity or tourism, admin or "民間"
    if amenity in ("school", "kindergarten", "university", "college"):
        if not name:
            return None
        return "school", amenity, admin or ("区" if "区立" in name else "")
    if amenity == "hospital":
        return "medical", "hospital", admin
    if amenity in ("social_facility", "childcare"):
        if not name:
            return None
        return "welfare", p.get("social_facility") or amenity, admin
    if leisure == "park":
        if not name:
            return None
        return "park", "park", admin or ("区" if re.search(r"区立|児童遊園", name) else "")
    if leisure in ("sports_centre", "stadium", "swimming_pool") and admin:
        return "sports", leisure, admin
    if p.get("military") or p.get("landuse") == "military":
        return "national", "military", "国"
    if amenity in ("townhall", "community_centre") or office == "government" or p.get("government") or amenity == "courthouse" or amenity == "prison":
        if not name:
            return None
        if admin == "国" or amenity in ("courthouse", "prison"):
            return "national", p.get("government") or amenity or "office", "国"
        if admin == "都":
            return "tokyo", p.get("government") or amenity or "office", "都"
        if admin == "区" or amenity in ("townhall", "community_centre"):
            return "ward", amenity or "office", "区"
        return "other", p.get("government") or "office", ""
    if admin in ("国", "都", "区") and name and (p.get("building") in ("government", "public", "civic") or office):
        return {"国": "national", "都": "tokyo", "区": "ward"}[admin], office or "facility", admin
    return None


def export_osm():
    pbf = WORK / "f_fac2.osm.pbf"
    seq = WORK / "f_fac2.geojsonseq"
    filters = [
        "nwr/office=government,diplomatic", "nwr/government", "nwr/diplomatic", "nwr/military", "wr/landuse=military",
        "nwr/amenity=townhall,courthouse,police,fire_station,embassy,prison,library,hospital,school,kindergarten,university,college,community_centre,arts_centre,theatre,planetarium,concert_hall,social_facility,childcare,post_office,toilets",
        "nwr/tourism=museum,gallery,aquarium,zoo", "nwr/leisure=park,sports_centre,stadium,swimming_pool", "nwr/building=government,public,civic",
    ]
    subprocess.run(["osmium", "tags-filter", str(SRC), *filters, "-o", str(pbf), "--overwrite"], check=True)
    subprocess.run(["osmium", "export", str(pbf), "-o", str(seq), "-f", "geojsonseq", "--overwrite", "-a", "type,id"], check=True)
    out = []
    with open(seq, encoding="utf-8") as f:
        for line in f:
            line = line.strip().lstrip("\x1e")
            if not line:
                continue
            feat = json.loads(line)
            p = feat["properties"]
            res = classify_osm(p)
            if not res:
                continue
            g = shape(feat["geometry"])
            pt = g if g.geom_type == "Point" else g.representative_point()
            area = 0.0 if g.geom_type == "Point" else g.area
            if res[0] == "park" and area and area < 2e-8:
                continue
            out.append({
                "name": nfkc(p.get("name")), "group": res[0], "sub": res[1], "admin": res[2],
                "lon": pt.x, "lat": pt.y, "src": "osm", "ref": f"{p.get('@type')}/{p.get('@id')}",
                "name_en": p.get("name:en"), "website": p.get("website") or p.get("contact:website"),
                "hours": p.get("opening_hours"), "wheelchair": p.get("wheelchair"),
                "country": p.get("country") or p.get("target"),
            })
    return out


def ksj_features(path):
    if str(path).endswith(".shp"):
        tmp = WORK / "ksj_tmp.geojson"
        subprocess.run(["ogr2ogr", "-f", "GeoJSON", str(tmp), str(path), "-oo", "ENCODING=CP932"], check=True, capture_output=True)
        path = tmp
    return json.loads(open(path, encoding="utf-8").read())["features"]


def in_wards(code):
    code = str(code or "")
    return code.startswith("131") and 1 <= int(code[3:5] or 0) <= 23


def ksj_records():
    rec = []

    def add(feat, name, group, sub, admin, ds, addr=""):
        c = feat["geometry"]["coordinates"]
        rec.append({"name": nfkc(name), "group": group, "sub": sub, "admin": admin, "lon": c[0], "lat": c[1], "src": "ksj", "ref": ds, "addr": nfkc(addr)})

    for f in ksj_features(KSJ / "P05-22_13_GML/P05-22_13.geojson"):
        p = f["properties"]
        if not in_wards(p["P05_001"]):
            continue
        sub = {"1": "townhall", "2": "branch_office", "3": "office", "4": "community_centre", "5": "assembly_hall"}.get(p["P05_002"], "facility")
        add(f, p["P05_003"], "ward", sub, "区", "国土数値情報P05(2022)", p["P05_004"])
    for f in ksj_features(KSJ / "P28-22_13/P28-22_13.geojson"):
        p = f["properties"]
        if not in_wards(p["P28_001"]):
            continue
        c = p["P28_002"]
        if c == "11161":
            add(f, p["P28_003"], "embassy", "embassy", "外国", "国土数値情報P28(2022)", p["P28_004"])
        elif c.startswith("03"):
            add(f, p["P28_003"], "culture", "museum", admin_from_name(p["P28_003"]) or "国", "国土数値情報P28(2022)", p["P28_004"])
        elif c.startswith("12") or c.startswith("13"):
            group = "tokyo" if c in ("12001", "13001") else "other"
            add(f, p["P28_003"], group, "office", "都" if group == "tokyo" else "", "国土数値情報P28(2022)", p["P28_004"])
        else:
            add(f, p["P28_003"], "national", "independent_agency" if c.startswith("09") else "office", "国", "国土数値情報P28(2022)", p["P28_004"])
    school_types = {"16001": "小学校", "16002": "中学校", "16003": "中等教育学校", "16004": "高等学校", "16005": "高等専門学校", "16006": "短期大学", "16007": "大学", "16011": "幼稚園", "16012": "特別支援学校", "16013": "認定こども園", "16014": "義務教育学校", "16015": "各種学校", "16016": "専修学校"}
    for f in ksj_features(KSJ / "P29-23_13_GML/P29-23_13_GML/P29-23_13.geojson"):
        p = f["properties"]
        if not in_wards(p["P29_001"]):
            continue
        admin = {"1": "国", "2": "都", "3": "区", "4": "民間"}.get(p["P29_006"], "")
        add(f, p["P29_004"], "school", school_types.get(p["P29_003"], "school"), admin, "国土数値情報P29(2023)", p["P29_005"])
    for f in ksj_features(KSJ / "P27-13_13/P27-13_13/P27-13_13.shp"):
        p = f["properties"]
        if not in_wards(p["P27_001"]):
            continue
        c = p["P27_004"]
        if c.startswith("030"):
            sub = {"03001": "美術館", "03002": "博物館", "03003": "図書館", "03004": "水族館", "03005": "動植物園"}.get(c, "culture")
            add(f, p["P27_005"], "culture", sub, admin_from_name(p["P27_005"]), "国土数値情報P27(2013)", p["P27_006"])
        else:
            add(f, p["P27_005"], "sports", "sports", admin_from_name(p["P27_005"]) or "公的", "国土数値情報P27(2013)", p["P27_006"])
    for f in ksj_features(KSJ / "P30-13_13/P30-13_13/P30-13_13.shp"):
        p = f["properties"]
        if not in_wards(p["P30_001"]) or "閉鎖" in (p["P30_005"] or ""):
            continue
        add(f, p["P30_005"], "post", "post_office", "公的", "国土数値情報P30(2013)", p["P30_006"])
    for f in ksj_features(KSJ / "P17-12_13_GML/P17-12_13_FireStation.shp"):
        p = f["properties"]
        if not in_wards(p["P17_002"]):
            continue
        add(f, p["P17_001"], "fire", "fire_station", "都", "国土数値情報P17(2012)", p["P17_004"])
    for f in ksj_features(KSJ / "P18-12_13_GML/P18-12_13_PoliceStation.shp"):
        p = f["properties"]
        if not in_wards(p["P18_002"]):
            continue
        name = p["P18_001"]
        add(f, name, "police", "koban" if re.search(r"(交番|駐在所|派出所)", name) else "station", "都", "国土数値情報P18(2012)", p["P18_004"])
    for f in ksj_features(KSJ / "P04-20_13_GML/P04-20_13_GML/P04-20_13.geojson"):
        p = f["properties"]
        if p["P04_001"] != 1 or not str(p.get("P04_003") or "").strip():
            continue
        add(f, p["P04_002"], "medical", "hospital", admin_from_name(p["P04_002"]), "国土数値情報P04(2020)", p["P04_003"])
    welfare_major = {"01": "保護施設", "02": "老人福祉施設", "03": "障害者支援施設", "04": "身体障害者社会参加支援施設", "05": "児童福祉施設", "06": "母子・父子福祉施設", "99": "その他"}
    for f in ksj_features(KSJ / "P14-23_13_GML/P14-23_13_GML/P14-23_13.geojson"):
        p = f["properties"]
        if not in_wards(p["P14_003"]):
            continue
        admin = {1: "公的", 2: "民間"}.get(p.get("P14_010"), "")
        add(f, p["P14_008"], "welfare", welfare_major.get(p["P14_005"], "welfare"), admin, "国土数値情報P14(2023)", p["P14_002"] + (p["P14_004"] or ""))
    return rec


def dedupe(records):
    kept = []
    seen = defaultdict(list)
    for r in records:
        k = (r["group"], key_name(r["name"]))
        if k[1] and any(abs(o["lon"] - r["lon"]) < 0.0035 and abs(o["lat"] - r["lat"]) < 0.0028 for o in seen[k]):
            continue
        seen[k].append(r)
        kept.append(r)
    return kept


def merge(osm, ksj, area):
    base = dedupe([r for r in osm if shapely.contains_xy(area, r["lon"], r["lat"])])
    tree = STRtree([Point(r["lon"], r["lat"]) for r in base])
    added = 0
    for r in ksj:
        if not shapely.contains_xy(area, r["lon"], r["lat"]):
            continue
        idx = tree.query(Point(r["lon"], r["lat"]), predicate="dwithin", distance=0.0018)
        match = None
        for i in idx:
            o = base[int(i)]
            if similar(o["name"], r["name"]):
                match = o
                break
        if match:
            if not match.get("admin") and r["admin"]:
                match["admin"] = r["admin"]
            if match["group"] in ("other",) and r["group"] != "other":
                match["group"] = r["group"]
            match.setdefault("also", r["ref"])
            if r.get("addr"):
                match.setdefault("addr", r["addr"])
            continue
        base.append(r)
        added += 1
    return base, added


def main():
    area = shape(json.loads((WORK / "wards_union.geojson").read_text())).buffer(0.001)
    shapely.prepare(area)
    osm = export_osm()
    ksj = ksj_records()
    merged, added = merge(osm, ksj, area)
    for r in merged:
        if r["group"] in ("school",) and r["admin"] == "区":
            r["group_admin"] = "区"
    counts = defaultdict(lambda: [0, 0])
    feats = []
    for r in merged:
        counts[r["group"]][0 if r["src"] == "osm" else 1] += 1
        mz = GROUPS[r["group"]][1]
        if r["group"] == "police" and r["sub"] == "station":
            mz = 13
        if r["group"] == "ward" and r["sub"] in ("townhall",):
            mz = 11
        props = {k: r.get(k) for k in ("name", "group", "sub", "admin", "src", "ref", "addr", "name_en", "website", "hours", "wheelchair", "country", "also")}
        f = feature({"type": "Point", "coordinates": [round(r["lon"], 6), round(r["lat"], 6)]}, props)
        f["tippecanoe"] = {"minzoom": mz}
        feats.append(f)
    write_geojsonseq(WORK / "layers" / "facility.geojsonseq", feats)
    for g, (a, b) in sorted(counts.items(), key=lambda x: -sum(x[1])):
        print(f"{GROUPS[g][0]}: OSM {a} + 国土数値情報 {b}")
    print("total", len(feats), "ksj added", added)
    write_json(WORK / "facility_groups.json", {k: v[0] for k, v in GROUPS.items()})


if __name__ == "__main__":
    main()
