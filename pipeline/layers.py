import json
import re
import subprocess
import sys
from collections import defaultdict

import osmium
import shapely
from shapely.geometry import box, mapping, shape
from shapely.ops import linemerge, split, unary_union

from common import BBOX, WORK, feature, parse_layer, write_geojsonseq

LAYERS = WORK / "layers"
SRC = WORK / "tokyo.osm.pbf"

ROAD_CLASS = {
    "motorway": "motorway", "motorway_link": "motorway", "trunk": "trunk", "trunk_link": "trunk",
    "primary": "primary", "primary_link": "primary", "secondary": "secondary", "secondary_link": "secondary",
    "tertiary": "tertiary", "tertiary_link": "tertiary", "unclassified": "minor", "residential": "minor",
    "living_street": "minor", "service": "service", "pedestrian": "path", "footway": "path", "path": "path",
    "steps": "path", "cycleway": "path", "track": "service",
}
ROAD_MINZOOM = {"motorway": 8, "trunk": 9, "primary": 10, "secondary": 11, "tertiary": 12, "minor": 13, "service": 15, "path": 15}
RAIL_KIND = {"rail", "subway", "light_rail", "monorail", "tram", "narrow_gauge", "funicular"}
RAIL_ROUTES = {"train", "subway", "light_rail", "monorail", "tram", "railway"}

NATIONAL = re.compile(
    r"(省|庁|国会|議員会館|内閣|最高裁判所|高等裁判所|地方裁判所|家庭裁判所|簡易裁判所|検察庁|法務局|税務署|国税|税関|"
    r"労働基準監督署|公共職業安定所|ハローワーク|入国|出入国|気象|宮内|皇居|御所|自衛隊|防衛|海上保安|人事院|会計検査院|"
    r"迎賓館|国立|独立行政法人|年金事務所|運輸支局|検疫所|日本銀行|国土地理院|特許|統計|拘置所|刑務所|少年院|"
    r"地方整備局|国道事務所|河川事務所|財務局|経済産業局|厚生局|運輸局|航空局|国家公務員|衆議院|参議院|首相官邸|総理大臣官邸)"
)
TOKYO = re.compile(r"(^東京都(?!.*区)|^都立|^都営|東京都庁|都庁|警視庁|東京消防庁|消防署|警察署|都税事務所|東京都水道局|東京都下水道局|東京都交通局|東京都建設局|東京都港湾局|東京都住宅供給公社|都民)")
TOKYO_OPERATOR = re.compile(r"^(東京都(?!\S{1,5}[区市町村](\s|$))|警視庁|東京消防庁|Tokyo Metropolitan Government)")
WARD = re.compile(r"(区役所|区民|区立|出張所|区総合庁舎|特別出張所)")
GOV_TAGS = {"townhall", "courthouse", "police", "fire_station", "prison"}


def run(*args):
    subprocess.run([str(a) for a in args], check=True)


def getid(ids, out):
    subprocess.run(["osmium", "getid", "-r", str(SRC), "-i", str(ids), "-o", str(out), "--overwrite"], check=False, stderr=subprocess.DEVNULL)


def export(name, filters, geom_types=None):
    pbf = WORK / f"f_{name}.osm.pbf"
    seq = WORK / f"f_{name}.geojsonseq"
    run("osmium", "tags-filter", SRC, *filters, "-o", pbf, "--overwrite")
    args = ["osmium", "export", pbf, "-o", seq, "-f", "geojsonseq", "--overwrite", "-a", "type,id"]
    if geom_types:
        args.append(f"--geometry-types={geom_types}")
    run(*args)
    with open(seq, encoding="utf-8") as f:
        for line in f:
            line = line.strip().lstrip("\x1e")
            if line:
                yield json.loads(line)


def centroid_feature(feat):
    g = shape(feat["geometry"])
    if g.geom_type == "Point":
        return feat["geometry"]
    return mapping(g.representative_point())


def with_zoom(feat, minzoom):
    feat["tippecanoe"] = {"minzoom": minzoom}
    return feat


def buildings():
    out = []
    for f in export("building", ["wr/building"], "polygon"):
        p = f["properties"]
        lv = p.get("building:levels")
        out.append(with_zoom(feature(f["geometry"], {"levels": int(lv) if lv and lv.isdigit() else None}), 14))
    n = write_geojsonseq(LAYERS / "building.geojsonseq", out)
    print("building", n)


def roads():
    out = []
    for f in export("road", ["w/highway"], "linestring"):
        p = f["properties"]
        cls = ROAD_CLASS.get(p.get("highway"))
        if not cls:
            continue
        layer = parse_layer(p.get("layer"))
        tunnel = 1 if p.get("tunnel") in ("yes", "building_passage", "covered") or (layer is not None and layer < 0) else 0
        if cls == "path" and tunnel:
            continue
        out.append(with_zoom(feature(f["geometry"], {
            "class": cls, "name": p.get("name"), "ref": p.get("ref"), "tunnel": tunnel,
            "bridge": 1 if p.get("bridge") not in (None, "no") else 0, "layer": layer,
        }), ROAD_MINZOOM[cls]))
    print("road", write_geojsonseq(LAYERS / "road.geojsonseq", out))


def sea_polygon():
    lines = []
    for f in export("coast", ["w/natural=coastline"], "linestring"):
        lines.append(shape(f["geometry"]))
    if not lines:
        return []
    frame = box(BBOX[0] + 0.02, BBOX[1] + 0.02, BBOX[2] - 0.02, BBOX[3] - 0.02)
    merged = linemerge(unary_union(lines))
    clipped = merged.intersection(frame)
    pieces = split(frame, clipped)
    seas = []
    probe_lines = list(clipped.geoms) if hasattr(clipped, "geoms") else [clipped]
    probes = []
    for ln in probe_lines:
        if ln.geom_type != "LineString" or ln.length < 1e-4:
            continue
        coords = list(ln.coords)
        for i in range(0, len(coords) - 1, max(1, (len(coords) - 1) // 5)):
            (x1, y1), (x2, y2) = coords[i], coords[i + 1]
            dx, dy = x2 - x1, y2 - y1
            norm = (dx * dx + dy * dy) ** 0.5 or 1
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            probes.append(((mx + dy / norm * 2e-5, my - dx / norm * 2e-5), 1))
            probes.append(((mx - dy / norm * 2e-5, my + dx / norm * 2e-5), 0))
    for piece in pieces.geoms:
        score = 0
        for (x, y), is_water in probes:
            if piece.contains(shapely.Point(x, y)):
                score += 1 if is_water else -1
        if score > 0:
            seas.append(piece)
    return seas


def water():
    polys = []
    for g in sea_polygon():
        polys.append(with_zoom(feature(mapping(g), {"kind": "sea"}), 0))
    for f in export("water", ["wr/natural=water,bay,strait", "wr/waterway=riverbank,dock", "wr/landuse=basin,reservoir", "wr/water"], "polygon"):
        polys.append(with_zoom(feature(f["geometry"], {"kind": "water"}), 8))
    print("water", write_geojsonseq(LAYERS / "water.geojsonseq", polys))
    lines = []
    for f in export("waterway", ["w/waterway=river,canal,stream,drain"], "linestring"):
        p = f["properties"]
        if p.get("tunnel") in ("culvert", "yes"):
            continue
        kind = p.get("waterway")
        lines.append(with_zoom(feature(f["geometry"], {"kind": kind, "name": p.get("name")}), 10 if kind in ("river", "canal") else 14))
    print("waterway", write_geojsonseq(LAYERS / "waterway.geojsonseq", lines))


def green():
    out = []
    for f in export("green", ["wr/leisure=park,garden,golf_course,pitch,playground", "wr/landuse=grass,forest,cemetery,recreation_ground,meadow", "wr/natural=wood,scrub,grassland"], "polygon"):
        p = f["properties"]
        kind = p.get("leisure") or p.get("landuse") or p.get("natural")
        g = shape(f["geometry"])
        area = g.area
        mz = 10 if area > 1e-5 else 12 if area > 1e-6 else 14
        out.append(with_zoom(feature(f["geometry"], {"kind": kind, "name": p.get("name")}), mz))
    print("green", write_geojsonseq(LAYERS / "green.geojsonseq", out))


def route_relations(kinds):
    rels = {}
    members = defaultdict(list)
    fp = osmium.FileProcessor(str(SRC), osmium.osm.RELATION)
    for r in fp:
        t = dict(r.tags)
        if t.get("type") != "route" or t.get("route") not in kinds:
            continue
        rels[r.id] = t
        for m in r.members:
            if m.type == "w" and m.role in ("", "forward", "backward", "main"):
                members[m.ref].append(r.id)
    return rels, members


def normalize_colour(c):
    if not c:
        return None
    c = c.strip()
    if re.fullmatch(r"#?[0-9A-Fa-f]{6}", c):
        return "#" + c.lstrip("#").upper()
    if re.fullmatch(r"#?[0-9A-Fa-f]{3}", c):
        c = c.lstrip("#")
        return "#" + "".join(ch * 2 for ch in c).upper()
    return c


def railways():
    rels, members = route_relations(RAIL_ROUTES)
    out = []
    for f in export("rail", ["w/railway"], "linestring"):
        p = f["properties"]
        kind = p.get("railway")
        if kind not in RAIL_KIND:
            continue
        wid = p.get("@id")
        routes = [rels[r] for r in members.get(wid, [])]
        colour = None
        for rt in routes:
            colour = normalize_colour(rt.get("colour"))
            if colour:
                break
        names = sorted({rt.get("name", "") for rt in routes if rt.get("name")})
        ops = sorted({rt.get("operator", "") for rt in routes if rt.get("operator")} | ({p["operator"]} if p.get("operator") else set()))
        layer = parse_layer(p.get("layer"))
        service = p.get("service")
        mz = 13 if service in ("yard", "siding", "spur", "crossover") else 8
        out.append(with_zoom(feature(f["geometry"], {
            "kind": kind, "name": p.get("name"), "colour": colour, "lines": " / ".join(names[:6]) or None,
            "operator": " / ".join(ops[:3]) or None,
            "tunnel": 1 if p.get("tunnel") not in (None, "no") or (layer is not None and layer < 0) else 0,
            "bridge": 1 if p.get("bridge") not in (None, "no") else 0,
            "service": service, "usage": p.get("usage"),
        }), mz))
    print("rail", write_geojsonseq(LAYERS / "rail.geojsonseq", out))


def stations():
    out = []
    seen = set()
    for f in export("station", ["nw/railway=station,halt", "n/public_transport=station"]):
        p = f["properties"]
        name = p.get("name")
        if not name:
            continue
        key = (name, p.get("operator"), round(shape(f["geometry"]).centroid.x, 3), round(shape(f["geometry"]).centroid.y, 3))
        if key in seen:
            continue
        seen.add(key)
        out.append(with_zoom(feature(centroid_feature(f), {
            "kind": "station", "name": name, "name_en": p.get("name:en"), "operator": p.get("operator"),
            "subway": 1 if p.get("station") == "subway" or p.get("subway") == "yes" else 0,
            "line": p.get("line") or p.get("railway:line"), "osm": f"{p.get('@type')}/{p.get('@id')}",
        }), 11))
    print("station", write_geojsonseq(LAYERS / "station.geojsonseq", out))


def buses():
    rels, members = route_relations({"bus", "trolleybus"})
    by_way = defaultdict(set)
    ops = defaultdict(set)
    for wid, rids in members.items():
        for rid in rids:
            t = rels[rid]
            label = t.get("ref") or t.get("name")
            if label:
                by_way[wid].add(label)
            if t.get("operator"):
                ops[wid].add(t["operator"])
    pbf = WORK / "f_busways.osm.pbf"
    ids = WORK / "busway_ids.txt"
    ids.write_text("\n".join(f"w{w}" for w in members), encoding="utf-8")
    getid(ids, pbf)
    seq = WORK / "f_busways.geojsonseq"
    run("osmium", "export", pbf, "-o", seq, "-f", "geojsonseq", "--overwrite", "-a", "type,id", "--geometry-types=linestring", "-c", WORK / "export_all_lines.json")
    out = []
    with open(seq, encoding="utf-8") as f:
        for line in f:
            line = line.strip().lstrip("\x1e")
            if not line:
                continue
            feat = json.loads(line)
            wid = feat["properties"].get("@id")
            refs = sorted(by_way.get(wid, []))
            out.append(with_zoom(feature(feat["geometry"], {
                "kind": "bus_route", "routes": " ".join(refs[:12]) or None, "n": len(refs),
                "operator": " / ".join(sorted(ops.get(wid, []))[:3]) or None,
            }), 11))
    print("bus_route", write_geojsonseq(LAYERS / "bus_route.geojsonseq", out), "relations", len(rels))
    stops = []
    for f in export("busstop", ["n/highway=bus_stop", "n/amenity=bus_station", "wr/amenity=bus_station"]):
        p = f["properties"]
        kind = "bus_station" if p.get("amenity") == "bus_station" else "bus_stop"
        stops.append(with_zoom(feature(centroid_feature(f), {
            "kind": kind, "name": p.get("name"), "operator": p.get("operator") or p.get("network"),
            "osm": f"{p.get('@type')}/{p.get('@id')}",
        }), 12 if kind == "bus_station" else 15))
    print("bus_stop", write_geojsonseq(LAYERS / "bus_stop.geojsonseq", stops))


def ferries():
    out = []
    for f in export("ferry", ["nwr/amenity=ferry_terminal", "w/route=ferry", "nwr/public_transport=station"]):
        p = f["properties"]
        if p.get("route") == "ferry" and f["geometry"]["type"] in ("LineString", "MultiLineString"):
            out.append(with_zoom(feature(f["geometry"], {"kind": "ferry_route", "name": p.get("name"), "operator": p.get("operator")}), 9))
        elif p.get("amenity") == "ferry_terminal" or p.get("ferry") == "yes":
            out.append(with_zoom(feature(centroid_feature(f), {"kind": "ferry_terminal", "name": p.get("name"), "operator": p.get("operator"), "osm": f"{p.get('@type')}/{p.get('@id')}"}), 10))
    rels, members = route_relations({"ferry"})
    if members:
        pbf = WORK / "f_ferryways.osm.pbf"
        ids = WORK / "ferryway_ids.txt"
        ids.write_text("\n".join(f"w{w}" for w in members), encoding="utf-8")
        getid(ids, pbf)
        seq = WORK / "f_ferryways.geojsonseq"
        run("osmium", "export", pbf, "-o", seq, "-f", "geojsonseq", "--overwrite", "-a", "type,id", "--geometry-types=linestring", "-c", WORK / "export_all_lines.json")
        with open(seq, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip().lstrip("\x1e")
                if not line:
                    continue
                feat = json.loads(line)
                wid = feat["properties"].get("@id")
                names = sorted({rels[r].get("name", "") for r in members.get(wid, []) if rels[r].get("name")})
                out.append(with_zoom(feature(feat["geometry"], {"kind": "ferry_route", "name": " / ".join(names[:3]) or None}), 9))
    print("ferry", write_geojsonseq(LAYERS / "ferry.geojsonseq", out))


def classify_facility(p):
    name = p.get("name", "") or ""
    op = p.get("operator", "") or ""
    text = name + " " + op + " " + (p.get("official_name", "") or "")
    amenity = p.get("amenity")
    if amenity == "embassy" or p.get("office") == "diplomatic" or "diplomatic" in p:
        sub = p.get("diplomatic") or ("embassy" if amenity == "embassy" else "diplomatic")
        return "embassy", sub
    if p.get("military") or p.get("landuse") == "military":
        return "national", "military"
    tokyo = TOKYO.search(name) or TOKYO_OPERATOR.search(op)
    if tokyo and not re.search(r"(区立|区役所|市立|市役所)", name):
        if amenity == "police" or "警察署" in name or "交番" in name:
            if "交番" in name or "駐在所" in name or p.get("police") == "koban":
                return None
            return "tokyo", "police"
        if amenity == "fire_station" or "消防署" in name or "消防" in op:
            return "tokyo", "fire_station"
        return "tokyo", p.get("government") or amenity or p.get("tourism") or p.get("leisure") or p.get("office") or "facility"
    if NATIONAL.search(text) and not re.search(r"(都立|区立|区役所|警視庁)", text):
        if p.get("office") == "government" or p.get("government") or amenity in GOV_TAGS or p.get("building") in ("government", "public", "civic"):
            return "national", p.get("government") or amenity or "office"
        if re.search(r"(国立|独立行政法人)", text) or re.search(r"(省|庁|裁判所|税務署|法務局|国会|議員会館|公共職業安定所|ハローワーク|労働基準監督署|年金事務所|税関|迎賓館|首相官邸|拘置所)", name):
            return "national", amenity or p.get("tourism") or "office"
    if amenity == "townhall" or WARD.search(name) and (p.get("office") == "government" or amenity in ("townhall", "community_centre")):
        return "ward", amenity or "office"
    if p.get("office") == "government" or p.get("government"):
        return "national" if NATIONAL.search(text) else "other_gov", p.get("government") or "office"
    if amenity == "courthouse":
        return "national", "courthouse"
    return None


def ward_area():
    area = shape(json.loads((WORK / "wards_union.geojson").read_text())).buffer(0.002)
    shapely.prepare(area)
    return area


def facilities():
    area = ward_area()
    out = []
    filters = [
        "nwr/office=government,diplomatic", "nwr/government", "nwr/diplomatic", "nwr/military", "wr/landuse=military",
        "nwr/amenity=townhall,courthouse,police,fire_station,embassy,prison,library,hospital,school,university,college,community_centre,arts_centre,social_facility",
        "nwr/tourism=museum,gallery", "nwr/leisure=park,sports_centre,stadium,garden", "nwr/building=government,public,civic",
    ]
    seen = set()
    for f in export("facility", filters):
        p = f["properties"]
        res = classify_facility(p)
        if not res:
            continue
        pt = centroid_feature(f)
        if not area.contains(shapely.Point(pt["coordinates"])):
            continue
        cat, sub = res
        key = (cat, p.get("name"), p.get("@type"), p.get("@id"))
        if key in seen:
            continue
        seen.add(key)
        mz = {"embassy": 12, "national": 11, "tokyo": 12, "ward": 12, "other_gov": 13}[cat]
        if cat == "tokyo" and sub in ("police", "fire_station"):
            mz = 13
        if cat == "tokyo" and p.get("leisure") == "park":
            mz = 12
        props = {
            "cat": cat, "sub": sub, "name": p.get("name"), "name_en": p.get("name:en"), "operator": p.get("operator"),
            "country": p.get("country") or p.get("target"), "osm": f"{p.get('@type')}/{p.get('@id')}",
            "addr": " ".join(x for x in [p.get("addr:city"), p.get("addr:quarter"), p.get("addr:neighbourhood"), p.get("addr:block_number"), p.get("addr:housenumber")] if x) or None,
            "website": p.get("website") or p.get("contact:website"),
        }
        out.append(with_zoom(feature(pt, props), mz))
    print("facility", write_geojsonseq(LAYERS / "facility.geojsonseq", out))


def places():
    out = []
    for f in export("place", ["n/place=city,town,suburb,quarter,neighbourhood,village,island"]):
        p = f["properties"]
        kind = p.get("place")
        mz = {"city": 8, "town": 10, "suburb": 11, "quarter": 13, "neighbourhood": 14, "village": 12, "island": 12}[kind]
        out.append(with_zoom(feature(f["geometry"], {"kind": kind, "name": p.get("name")}), mz))
    print("place", write_geojsonseq(LAYERS / "place.geojsonseq", out))


def main():
    LAYERS.mkdir(parents=True, exist_ok=True)
    (WORK / "export_all_lines.json").write_text(json.dumps({"linear_tags": True, "area_tags": False}))
    steps = [buildings, roads, water, green, railways, stations, buses, ferries, facilities, places]
    only = set(sys.argv[1:])
    for step in steps:
        if not only or step.__name__ in only:
            step()


if __name__ == "__main__":
    main()
