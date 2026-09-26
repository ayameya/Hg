import json
import subprocess

import osmium
from shapely.geometry import LineString, mapping, shape
from shapely.ops import polygonize, unary_union

from common import WARDS, WORK, feature, write_geojsonseq, write_json


def load_wards():
    src = WORK / "tokyo.osm.pbf"
    admin = WORK / "admin.osm.pbf"
    seq = WORK / "admin.geojsonseq"
    subprocess.run(["osmium", "tags-filter", str(src), "r/boundary=administrative", "-o", str(admin), "--overwrite"], check=True)
    subprocess.run(["osmium", "export", str(admin), "-o", str(seq), "-f", "geojsonseq", "--geometry-types=polygon", "--overwrite", "-a", "type,id"], check=True)
    wards = {}
    with open(seq, encoding="utf-8") as f:
        for line in f:
            line = line.strip().lstrip("\x1e")
            if not line:
                continue
            feat = json.loads(line)
            p = feat["properties"]
            if p.get("admin_level") != "7" or p.get("name") not in WARDS:
                continue
            geom = shape(feat["geometry"])
            if not geom.is_valid:
                geom = geom.buffer(0)
            name = p["name"]
            if name in wards and wards[name]["geom"].area >= geom.area:
                continue
            wards[name] = {"geom": geom, "props": p}
    missing = [w for w in WARDS if w not in wards]
    for name in missing:
        geom, props = assemble(admin, name)
        if geom is not None:
            wards[name] = {"geom": geom, "props": props}
    missing = [w for w in WARDS if w not in wards]
    if missing:
        raise SystemExit(f"missing wards: {missing}")
    return wards


def assemble(pbf, name):
    rel = None
    for o in osmium.FileProcessor(str(pbf), osmium.osm.RELATION):
        if o.tags.get("name") == name and o.tags.get("admin_level") == "7":
            rel = (dict(o.tags), [m.ref for m in o.members if m.type == "w" and m.role in ("outer", "inner", "")])
            break
    if rel is None:
        return None, None
    ids = set(rel[1])
    lines = []
    incomplete = 0
    fp = osmium.FileProcessor(str(WORK / "tokyo.osm.pbf"), osmium.osm.NODE | osmium.osm.WAY).with_locations().with_filter(osmium.filter.EntityFilter(osmium.osm.WAY)).with_filter(osmium.filter.IdFilter(ids))
    for w in fp:
        coords = [(n.location.lon, n.location.lat) for n in w.nodes if n.location.valid()]
        if len(coords) < len(w.nodes):
            incomplete += 1
        if len(coords) >= 2:
            lines.append(LineString(coords))
    polys = list(polygonize(unary_union(lines)))
    if not polys and incomplete:
        print(f"WARNING: {name} boundary has {incomplete} incomplete ways; using convex hull. Extract a wider bbox.")
        polys = [unary_union(lines).convex_hull]
    if not polys:
        return None, None
    geom = unary_union(polys)
    print("assembled", name, "from", len(lines), "ways")
    return geom, rel[0]


def main():
    wards = load_wards()
    feats = []
    for name in WARDS:
        w = wards[name]
        p = w["props"]
        feats.append(feature(mapping(w["geom"]), {"name": name, "name_en": p.get("name:en"), "code": p.get("ref") or p.get("jisx0402")}))
    write_json(WORK / "wards.geojson", {"type": "FeatureCollection", "features": feats})
    union = unary_union([w["geom"] for w in wards.values()])
    write_json(WORK / "wards_union.geojson", mapping(union))
    labels = []
    for name in WARDS:
        pt = wards[name]["geom"].representative_point()
        labels.append(feature(mapping(pt), {"name": name, "kind": "ward"}))
    write_geojsonseq(WORK / "layers" / "ward_label.geojsonseq", labels)
    write_geojsonseq(WORK / "layers" / "ward.geojsonseq", [feature(mapping(wards[n]["geom"].boundary), {"name": n}) for n in WARDS])
    print("wards ok", len(wards), round(union.area, 5))


if __name__ == "__main__":
    main()
