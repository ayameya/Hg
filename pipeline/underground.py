import json
import pickle
import re
import subprocess
from collections import defaultdict

import numpy as np
import osmium
import shapely
import shapely.geometry
from shapely.geometry import LineString, Point, shape
from shapely.strtree import STRtree

from common import OUT, PIPE, WORK, haversine, line_length, parse_layer, parse_levels, r6, write_json

PED = {"footway", "pedestrian", "path", "corridor", "steps", "elevator", "living_street", "track"}
LINKLIKE = {"steps", "elevator"}
NOT_WALKABLE_ACCESS = {"private", "no"}
WALK_OK = {"yes", "designated", "permissive", "destination"}
KEEP_TAGS = [
    "highway", "name", "name:en", "ref", "level", "layer", "tunnel", "indoor", "location", "access", "foot",
    "opening_hours", "conveying", "incline", "wheelchair", "covered", "operator", "fee", "area",
]
MALL_NAME = re.compile(r"(地下街|ヤエチカ|しぶちか|エチカ|地下商店街|サブナード|ホープセンター|ショッピングパーク|京王モール|小田急エース|メトロピア|地下\d+番通り|外堀地下|Yaechika)")
OUTDOOR_NAME = re.compile(r"(親水|テラス|遊歩道|緑道|ジョギング|サイクリング|河川|リバーサイド|散策路|公園)")
STATION_NAME = re.compile(r"(駅|改札|番線|コンコース|乗換|のりかえ|連絡通路|Interchanging)")
FOOD = {"restaurant", "cafe", "fast_food", "bar", "pub", "ice_cream"}
DEFAULT_HOURS = {
    "station": ("05:00-01:00", "駅の地下コンコース・駅出入口は終電後〜始発前に閉鎖されるのが一般的"),
    "mall": ("06:00-24:00", "地下街の通路は深夜にシャッターで閉鎖されることが多い"),
    "building": ("07:00-23:00", "ビル地下の通路・連絡通路は建物の開館時間に準じる"),
    "public": ("24/7", "道路管理者が管理する地下歩道・横断地下道は終日通行可能なことが多い"),
}


def walkable(t):
    if t.get("access") in NOT_WALKABLE_ACCESS and t.get("foot") not in WALK_OK:
        return False
    if t.get("foot") == "no":
        return False
    if t.get("area") == "yes":
        return False
    return True


def is_underground(t):
    layer = parse_layer(t.get("layer"))
    levels = parse_levels(t.get("level"))
    if layer is not None and layer < 0:
        return True
    if levels and max(levels) < 0:
        return True
    if levels and min(levels) < 0 and t.get("highway") in LINKLIKE:
        return True
    if t.get("location") in ("underground",):
        return True
    if t.get("tunnel") in ("yes", "passage") and (layer is None or layer < 0):
        return True
    return False


def depth(t):
    levels = parse_levels(t.get("level"))
    if levels:
        return min(levels)
    layer = parse_layer(t.get("layer"))
    if layer is not None:
        return layer
    return -1.0 if is_underground(t) else 0.0


def prefilter():
    src = WORK / "tokyo.osm.pbf"
    ped = WORK / "ped.osm.pbf"
    areas = WORK / "ugareas.osm.pbf"
    subprocess.run([
        "osmium", "tags-filter", str(src),
        "w/highway", "w/indoor=corridor",
        "n/railway=subway_entrance,station,halt,train_station_entrance", "n/entrance", "n/highway=elevator",
        "n/public_transport=station", "n/opening_hours", "n/shop", "n/amenity=restaurant,cafe,fast_food,bar,pub,ice_cream",
        "-o", str(ped), "--overwrite",
    ], check=True)
    subprocess.run([
        "osmium", "tags-filter", str(src),
        "wr/shop=mall", "wr/railway=station", "wr/public_transport=station", "wr/building=train_station",
        "wr/indoor=area,room,corridor", "wr/amenity=marketplace", "wr/place=square",
        "-o", str(areas), "--overwrite",
    ], check=True)
    return ped, areas


def load_ways(ped):
    ways = {}
    surface_nodes = set()
    points = {}
    ug_areas = []
    fp = osmium.FileProcessor(str(ped)).with_locations()
    for o in fp:
        if o.is_node():
            t = dict(o.tags)
            if not t:
                continue
            kind = None
            if t.get("railway") in ("subway_entrance", "train_station_entrance") or "entrance" in t:
                kind = "entrance"
            elif t.get("highway") == "elevator":
                kind = "elevator"
            elif t.get("railway") in ("station", "halt") or t.get("public_transport") == "station":
                kind = "station"
            elif ("shop" in t or t.get("amenity") in FOOD) and is_underground(t):
                kind = "shop"
            elif "opening_hours" in t:
                kind = "hours"
            if kind:
                points[o.id] = (kind, o.location.lon, o.location.lat, t)
        elif o.is_way():
            t = dict(o.tags)
            hw = t.get("highway")
            refs = []
            coords = []
            ok = True
            for n in o.nodes:
                if not n.location.valid():
                    ok = False
                    break
                refs.append(n.ref)
                coords.append((n.location.lon, n.location.lat))
            if not ok or len(refs) < 2:
                continue
            if refs[0] == refs[-1] and len(refs) >= 4 and (t.get("area") == "yes" or t.get("indoor") in ("area", "corridor")) and (hw in PED or "indoor" in t) and is_underground(t):
                ug_areas.append({"id": o.id, "coords": coords, "tags": {k: t[k] for k in ("name", "level", "layer", "indoor", "highway") if k in t}})
            pedestrian = (hw in PED or t.get("indoor") == "corridor" or (hw in ("service", "residential", "unclassified") and is_underground(t) and t.get("foot") in WALK_OK)) and walkable(t)
            if pedestrian and hw not in ("platform",):
                ways[o.id] = {"tags": {k: t[k] for k in KEEP_TAGS if k in t}, "refs": refs, "coords": coords, "ug": is_underground(t)}
            elif hw and hw not in ("proposed", "construction", "platform", "abandoned", "razed"):
                if not is_underground(t):
                    surface_nodes.update(refs)
    return ways, surface_nodes, points, ug_areas


def load_areas(areas_pbf):
    polys = {"station": [], "mall": [], "named": []}
    fp = osmium.FileProcessor(str(areas_pbf)).with_areas().with_filter(osmium.filter.EntityFilter(osmium.osm.AREA))
    wkb = osmium.geom.WKBFactory()
    for o in fp:
        t = dict(o.tags)
        try:
            g = shapely.from_wkb(wkb.create_multipolygon(o))
        except Exception:
            continue
        if g is None or g.is_empty:
            continue
        if not g.is_valid:
            g = g.buffer(0)
        name = t.get("name", "")
        if t.get("railway") == "station" or t.get("public_transport") == "station" or t.get("building") == "train_station":
            polys["station"].append((g, name))
        lv = parse_levels(t.get("level"))
        under = (lv and max(lv) < 0) or (parse_layer(t.get("layer")) or 0) < 0 or t.get("location") == "underground"
        if (t.get("shop") == "mall" or t.get("amenity") == "marketplace" or t.get("place") == "square") and (under or MALL_NAME.search(name)):
            polys["mall"].append((g, name))
        if name:
            polys["named"].append((g, name))
    return polys


def load_buildings():
    seq = WORK / "layers" / "building.geojsonseq"
    geoms = []
    with open(seq, encoding="utf-8") as f:
        for line in f:
            feat = json.loads(line)
            geoms.append(shape(feat["geometry"]))
    return geoms


def select_network(ways, union):
    ug = {wid: w for wid, w in ways.items() if w["ug"]}
    area = union.buffer(0.001)
    shapely.prepare(area)
    keep = {}
    for wid, w in ug.items():
        t = w["tags"]
        if OUTDOOR_NAME.search(t.get("name", "")) and "indoor" not in t:
            continue
        if t.get("highway") in ("path", "track") and "tunnel" not in t and "indoor" not in t:
            continue
        xs = np.array([c[0] for c in w["coords"]])
        ys = np.array([c[1] for c in w["coords"]])
        if shapely.contains_xy(area, xs, ys).any():
            keep[wid] = dict(w, role="ug")
    node_set = set()
    for w in keep.values():
        node_set.update(w["refs"])
    for _ in range(2):
        added = {}
        for wid, w in ways.items():
            if wid in keep or w["ug"]:
                continue
            t = w["tags"]
            linky = t.get("highway") in LINKLIKE or "conveying" in t or (t.get("highway") in ("footway", "corridor") and ("incline" in t or t.get("indoor") == "yes" or "level" in t))
            if not linky:
                continue
            if node_set.intersection(w["refs"]) and line_length(w["coords"]) < 150:
                added[wid] = dict(w, role="connector")
        keep.update(added)
        for w in added.values():
            node_set.update(w["refs"])
    return keep


def split_edges(keep):
    count = defaultdict(int)
    for w in keep.values():
        for i, r in enumerate(w["refs"]):
            count[r] += 1 if 0 < i < len(w["refs"]) - 1 else 2
    edges = []
    for wid, w in keep.items():
        refs, coords = w["refs"], w["coords"]
        start = 0
        for i in range(1, len(refs)):
            if i == len(refs) - 1 or count[refs[i]] >= 2:
                seg_refs = refs[start:i + 1]
                seg = coords[start:i + 1]
                if len(seg_refs) > 2 or seg_refs[0] != seg_refs[-1]:
                    edges.append({"way": wid, "a": seg_refs[0], "b": seg_refs[-1], "coords": seg, "w": w})
                start = i
    return edges


def classify(edges, polys, buildings, points):
    st_geoms = [g for g, _ in polys["station"]]
    mall_geoms = [g for g, _ in polys["mall"]]
    st_tree = STRtree(st_geoms) if st_geoms else None
    mall_tree = STRtree(mall_geoms) if mall_geoms else None
    b_tree = STRtree(buildings) if buildings else None
    st_pts = [Point(v[1], v[2]) for v in points.values() if v[0] == "station"]
    st_pt_tree = STRtree(st_pts) if st_pts else None
    station_names = {v[3].get("name") for v in points.values() if v[0] == "station" and v[3].get("name")}
    shops = [Point(v[1], v[2]) for v in points.values() if v[0] == "shop"]
    shop_tree = STRtree(shops) if shops else None
    mids = []
    for e in edges:
        ls = LineString(e["coords"])
        mids.append(ls.interpolate(0.5, normalized=True))
    mids_arr = np.array(mids, dtype=object)

    def hit(tree, pts, dist=None):
        res = np.zeros(len(pts), dtype=bool)
        if tree is None:
            return res
        if dist is None:
            idx = tree.query(pts, predicate="intersects")
        else:
            idx = tree.query(pts, predicate="dwithin", distance=dist)
        res[np.unique(idx[0])] = True
        return res

    shop_count = np.zeros(len(edges), dtype=int)
    if shop_tree is not None:
        idx = shop_tree.query(mids_arr, predicate="dwithin", distance=0.0003)
        np.add.at(shop_count, idx[0], 1)
    in_mall = hit(mall_tree, mids_arr, 0.0002)
    in_station_poly = hit(st_tree, mids_arr)
    near_station_poly = hit(st_tree, mids_arr, 0.0006)
    near_station_pt = hit(st_pt_tree, mids_arr, 0.0025)
    in_building = hit(b_tree, mids_arr)
    for i, e in enumerate(edges):
        t = e["w"]["tags"]
        name = t.get("name", "")
        station_named = bool(name) and (name in station_names or bool(STATION_NAME.search(name)) or any(n and n in name for n in name.replace(";", " ").split() if n in station_names))
        if in_mall[i] or MALL_NAME.search(name):
            cat = "mall"
        elif station_named:
            cat = "station"
        elif shop_count[i] >= 4 and not in_station_poly[i]:
            cat = "mall"
        elif in_station_poly[i]:
            cat = "station"
        elif in_building[i]:
            cat = "building"
        elif near_station_poly[i] or near_station_pt[i]:
            cat = "station"
        else:
            cat = "public"
        e["cat"] = cat
        e["mid"] = mids[i]


def load_overrides(polys):
    path = PIPE / "overrides" / "hours.json"
    rules = json.loads(path.read_text(encoding="utf-8"))["edges"]
    named = defaultdict(list)
    for g, n in polys["named"]:
        named[n].append(g)
    for r in rules:
        m = r["match"]
        geoms = []
        for n in m.get("area_names", []):
            geoms.extend(named.get(n, []))
        if "area_regex" in m:
            rx = re.compile(m["area_regex"])
            for n, gs in named.items():
                if rx.search(n):
                    geoms.extend(gs)
        if "polygon" in m:
            geoms.append(shapely.Polygon(m["polygon"][0], m["polygon"][1:]))
        r["_geom"] = shapely.unary_union(geoms) if geoms else None
        r["_ways"] = set(m.get("ways", []))
        r["_name"] = re.compile(m["name_regex"]) if "name_regex" in m else None
        r["_cats"] = set(m.get("categories", []))
        if (m.get("area_names") or m.get("area_regex")) and not geoms:
            print("override area not found:", r["id"], m["area_names"])
    return rules


def apply_hours(edges, rules):
    for e in edges:
        t = e["w"]["tags"]
        rule = None
        for r in rules:
            if r["_cats"] and e["cat"] not in r["_cats"]:
                continue
            if e["way"] in r["_ways"]:
                rule = r
            elif r["_name"] is not None and r["_name"].search(t.get("name", "")):
                rule = r
            elif r["_geom"] is not None and r["_geom"].intersects(e["mid"]):
                rule = r
            if rule:
                break
        if "opening_hours" in t:
            e["oh"], e["src"], e["conf"], e["note"], e["rule"] = t["opening_hours"], "osm", "high", "OpenStreetMap opening_hours タグ", None
        elif rule:
            e["oh"], e["src"], e["conf"], e["note"], e["rule"] = rule["opening_hours"], "override", rule.get("confidence", "medium"), rule.get("note", ""), rule["id"]
        else:
            oh, note = DEFAULT_HOURS[e["cat"]]
            e["oh"], e["src"], e["conf"], e["note"], e["rule"] = oh, "default", "low", note, None


EXIT_REF = re.compile(r"(?<![A-Za-z0-9])([A-Z]{1,2}\d{1,2}[a-z]?(?:\(\d\))?)(?![A-Za-z0-9])")


def exit_ref(t):
    if t.get("ref"):
        return t["ref"]
    m = EXIT_REF.search(t.get("name", "") or "")
    return m.group(1) if m else ""


def rule_station_ok(r, t, coord, station_lookup):
    want = r.get("station")
    if not want:
        return True
    name = t.get("name", "") or ""
    if want in name:
        return True
    if re.sub(EXIT_REF, "", name).strip(" 　駅出入口") and not name.startswith(want):
        return False
    return want in station_lookup(coord)


def node_hours(t, coord, label, flags, entrance_rules, ohid, station_lookup):
    gate = bool(flags & 6) or "barrier" in t or "door" in t
    if "opening_hours" in t and gate and "shop" not in t and "amenity" not in t:
        return ohid(t["opening_hours"]), "osm", ""
    if flags & 2 and label:
        for r in entrance_rules:
            if label in r["refs"] and haversine(coord, r["center"]) <= r["radius_m"] and rule_station_ok(r, t, coord, station_lookup):
                return ohid(r["opening_hours"]), "override", r["id"]
    return -1, "", ""


def write_areas(ug_areas, union):
    feats = []
    for a in ug_areas:
        poly = shapely.Polygon(a["coords"])
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty or not union.intersects(poly):
            continue
        t = a["tags"]
        g = shapely.geometry.mapping(poly)
        feats.append({"type": "Feature", "geometry": {"type": g["type"], "coordinates": round_coords(g["coordinates"])}, "properties": {"name": t.get("name", ""), "level": depth(t), "way": a["id"]}})
    write_json(OUT / "areas.json", {"type": "FeatureCollection", "features": feats})
    print("areas", len(feats))


def round_coords(c):
    if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
        return [r6(c[0]), r6(c[1])]
    return [round_coords(x) for x in c]


def build(ways, surface_nodes, points, polys, buildings, union):
    keep = select_network(ways, union)
    edges = split_edges(keep)
    classify(edges, polys, buildings, points)
    for e in edges:
        if e["w"]["role"] == "connector":
            e["cat_base"] = e["cat"]
    rules = load_overrides(polys)
    apply_hours(edges, rules)
    entrance_rules = json.loads((PIPE / "overrides" / "hours.json").read_text(encoding="utf-8")).get("entrances", [])

    node_ids = {}
    nodes = []
    net_nodes = set()
    for e in edges:
        net_nodes.add(e["a"])
        net_nodes.add(e["b"])
    all_refs = set()
    for w in keep.values():
        all_refs.update(w["refs"])
    coord_of = {}
    for w in keep.values():
        for r, c in zip(w["refs"], w["coords"]):
            coord_of[r] = c

    def nid(ref):
        if ref not in node_ids:
            node_ids[ref] = len(nodes)
            nodes.append({"ref": ref, "c": coord_of[ref]})
        return node_ids[ref]

    oh_table = []
    oh_index = {}

    def ohid(s):
        if s not in oh_index:
            oh_index[s] = len(oh_table)
            oh_table.append(s)
        return oh_index[s]

    note_table = []
    note_index = {}

    def noteid(s):
        if s not in note_index:
            note_index[s] = len(note_table)
            note_table.append(s)
        return note_index[s]

    out_edges = []
    for e in edges:
        t = e["w"]["tags"]
        a, b = nid(e["a"]), nid(e["b"])
        lvl = depth(t)
        out_edges.append([
            a, b,
            [[r6(x), r6(y)] for x, y in e["coords"]],
            round(line_length(e["coords"]), 1),
            e["way"],
            e["cat"],
            1 if e["w"]["role"] == "connector" else 0,
            t.get("highway", ""),
            t.get("name", ""),
            lvl,
            ohid(e["oh"]),
            e["src"],
            e["conf"],
            noteid(e["note"]),
            e["rule"] or "",
            t.get("wheelchair", ""),
        ])

    access = set()
    for ref in node_ids:
        if ref in surface_nodes:
            access.add(ref)
    degree = defaultdict(int)
    for e in edges:
        degree[e["a"]] += 1
        degree[e["b"]] += 1
    for e in edges:
        if e["w"]["role"] != "connector":
            continue
        for end in (e["a"], e["b"]):
            if degree[end] == 1 and depth(e["w"]["tags"]) >= -0.5:
                access.add(end)
    entrance_info = {}
    for ref, (kind, lon, lat, t) in points.items():
        if ref in node_ids and kind in ("entrance", "elevator", "hours"):
            entrance_info[ref] = t
            if kind in ("entrance", "elevator"):
                access.add(ref)

    unattached = []
    ug_coords = np.array([n["c"] for n in nodes])
    tree = STRtree([Point(c) for c in ug_coords]) if len(nodes) else None
    for ref, (kind, lon, lat, t) in points.items():
        if kind != "entrance" or ref in node_ids:
            continue
        if t.get("railway") not in ("subway_entrance", "train_station_entrance"):
            continue
        if not shapely.contains_xy(union, lon, lat):
            continue
        near = tree.query(Point(lon, lat), predicate="dwithin", distance=0.0005) if tree is not None else []
        if len(near) == 0:
            continue
        best = int(min(near, key=lambda i: haversine((lon, lat), nodes[i]["c"])))
        d = haversine((lon, lat), nodes[best]["c"])
        if d > 40:
            continue
        unattached.append((ref, lon, lat, t, best, d))

    st_list = [(v[1], v[2], v[3].get("name", "")) for v in points.values() if v[0] == "station" and v[3].get("name")]
    st_tree = STRtree([Point(x, y) for x, y, _ in st_list])

    def station_lookup(coord):
        i = st_tree.nearest(Point(coord))
        return st_list[int(i)][2] if i is not None else ""

    out_nodes = []
    for i, n in enumerate(nodes):
        ref = n["ref"]
        t = entrance_info.get(ref, {})
        flags = 0
        if ref in access:
            flags |= 1
        if t.get("railway") in ("subway_entrance", "train_station_entrance") or "entrance" in t:
            flags |= 2
        if t.get("highway") == "elevator":
            flags |= 4
        label = exit_ref(t)
        name = t.get("name") or ""
        oh, src, rule = node_hours(t, n["c"], label, flags, entrance_rules, ohid, station_lookup)
        out_nodes.append([r6(n["c"][0]), r6(n["c"][1]), flags, oh, label, name, ref, src, rule])

    for ref, lon, lat, t, best, d in unattached:
        idx = len(out_nodes)
        flags = 1 | 2
        oh, src, rule = node_hours(t, (lon, lat), exit_ref(t), flags, entrance_rules, ohid, station_lookup)
        out_nodes.append([r6(lon), r6(lat), flags, oh, exit_ref(t), t.get("name") or "", ref, src, rule])
        bx, by = nodes[best]["c"]
        host = next((e for e in out_edges if e[0] == best or e[1] == best), None)
        out_edges.append([
            idx, best, [[r6(lon), r6(lat)], [r6(bx), r6(by)]], round(d, 1), 0, host[5] if host else "station", 1, "virtual", "", 0.0,
            host[10] if host else ohid(DEFAULT_HOURS["station"][0]), "virtual", "low", noteid("OSM上で出入口ノードが地下通路に接続されていないため、最寄りの地下通路ノードへ仮接続（通行時間は接続先の通路に準じる）"), "", "",
        ])

    rules_meta = [{k: v for k, v in r.items() if not k.startswith("_") and k != "match"} for r in rules + entrance_rules]
    net = {
        "generated": subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True).stdout.strip(),
        "source": "© OpenStreetMap contributors (ODbL)",
        "edge_fields": ["a", "b", "coords", "len", "way", "cat", "connector", "highway", "name", "level", "oh", "src", "conf", "note", "rule", "wheelchair"],
        "node_fields": ["lon", "lat", "flags", "oh", "ref", "name", "osm_id", "src", "rule"],
        "oh": oh_table,
        "notes": note_table,
        "defaults": {k: {"opening_hours": v[0], "note": v[1]} for k, v in DEFAULT_HOURS.items()},
        "rules": rules_meta,
        "nodes": out_nodes,
        "edges": out_edges,
    }
    write_json(OUT / "network.json", net)
    stats = defaultdict(float)
    for e in out_edges:
        stats[e[5]] += e[3]
    print("edges", len(out_edges), "nodes", len(out_nodes), "access", sum(1 for n in out_nodes if n[2] & 1), "virtual", len(unattached))
    print({k: round(v / 1000, 1) for k, v in stats.items()}, "km total", round(sum(stats.values()) / 1000, 1))


def load_inputs():
    cache = WORK / "underground_inputs.pkl"
    src = WORK / "tokyo.osm.pbf"
    if cache.exists() and cache.stat().st_mtime > src.stat().st_mtime and cache.stat().st_mtime > (WORK / "layers" / "building.geojsonseq").stat().st_mtime:
        with open(cache, "rb") as f:
            return pickle.load(f)
    ped, areas = prefilter()
    ways, surface_nodes, points, ug_areas = load_ways(ped)
    polys = load_areas(areas)
    buildings = load_buildings()
    data = (ways, surface_nodes, points, polys, buildings, ug_areas)
    with open(cache, "wb") as f:
        pickle.dump(data, f, protocol=pickle.HIGHEST_PROTOCOL)
    return data


def main():
    union = shape(json.loads((WORK / "wards_union.geojson").read_text()))
    ways, surface_nodes, points, polys, buildings, ug_areas = load_inputs()
    build(ways, surface_nodes, points, polys, buildings, union)
    write_areas(ug_areas, union)


if __name__ == "__main__":
    main()
