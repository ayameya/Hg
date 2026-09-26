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
    steps = [buildings, roads, water, green, railways, stations, buses, ferries, places]
    only = set(sys.argv[1:])
    for step in steps:
        if not only or step.__name__ in only:
            step()


if __name__ == "__main__":
    main()
