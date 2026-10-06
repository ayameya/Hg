import json
import math

import numpy as np
import shapely
from shapely.geometry import mapping, shape
from shapely.strtree import STRtree

from common import OUT, WORK, write_geojsonseq

CLIP = (139.54, 35.50, 139.94, 35.83)
LAT0 = 35.68
M2 = (111320.0 ** 2) * math.cos(math.radians(LAT0))
DEG_M = 1 / 111320.0
SMALL_M2 = 1500
BIG_M2 = 3000
ENTRANCE_BUFFER_M = 4
NOT_ENTERABLE = {"roof", "canopy", "carport", "bridge", "construction", "ruins", "shelter"}


def entrance_points():
    net = json.loads((OUT / "network.json").read_text(encoding="utf-8"))
    nf = {k: i for i, k in enumerate(net["node_fields"])}
    ef = {k: i for i, k in enumerate(net["edge_fields"])}
    connector_nodes = set()
    for e in net["edges"]:
        if e[ef["connector"]] or e[ef["highway"]] in ("steps", "elevator"):
            connector_nodes.add(e[ef["a"]])
            connector_nodes.add(e[ef["b"]])
    pts = []
    for i, n in enumerate(net["nodes"]):
        flags = n[nf["flags"]]
        if flags & 2 or flags & 4 or (flags & 1 and i in connector_nodes):
            pts.append(shapely.Point(n[0], n[1]))
    return pts


def load():
    geoms, names, ids, kinds = [], [], [], []
    with open(WORK / "layers" / "building.geojsonseq", encoding="utf-8") as f:
        for line in f:
            x = json.loads(line)
            g = shape(x["geometry"])
            if g.geom_type == "MultiPolygon":
                g = max(g.geoms, key=lambda p: p.area)
            c = g.centroid
            if not (CLIP[0] <= c.x <= CLIP[2] and CLIP[1] <= c.y <= CLIP[3]):
                continue
            geoms.append(shapely.Polygon(g.exterior))
            names.append(x["properties"].get("name") or "")
            ids.append(x["properties"].get("id") or "")
            kinds.append(x["properties"].get("b") or "yes")
    return np.array(geoms, dtype=object), names, ids, kinds


def main():
    geoms, names, ids, kinds = load()
    geoms = shapely.make_valid(geoms)
    area = shapely.area(geoms) * M2
    rect = shapely.oriented_envelope(geoms)
    fill = np.divide(area, shapely.area(rect) * M2, out=np.zeros_like(area), where=shapely.area(rect) > 0)
    nverts = shapely.get_num_coordinates(geoms)
    use_rect = (area < SMALL_M2) & (fill > 0.78) & (nverts > 5)
    simple = shapely.simplify(geoms, 1.0 * DEG_M, preserve_topology=False)
    out_geoms = np.where(use_rect, rect, simple)
    bad = shapely.is_empty(out_geoms) | (shapely.get_type_id(out_geoms) != 3)
    out_geoms = np.where(bad, rect, out_geoms)

    ent = entrance_points()
    tree = STRtree(ent)
    hit = tree.query(shapely.buffer(geoms, ENTRANCE_BUFFER_M * DEG_M, quad_segs=1), predicate="intersects")
    ug = np.zeros(len(geoms), dtype=bool)
    ug[np.unique(hit[0])] = True
    open_structure = np.array([k in NOT_ENTERABLE for k in kinds])
    ug &= ~open_structure

    feats = []
    verts = 0
    for i, g in enumerate(out_geoms):
        if g is None or g.is_empty or g.geom_type != "Polygon":
            continue
        verts += len(g.exterior.coords) - 1
        props = {}
        if ug[i]:
            props["u"] = 1
        if names[i] and (area[i] > 400 or ug[i]):
            props["n"] = names[i]
        if ug[i] or names[i]:
            props["id"] = ids[i]
        feats.append({"type": "Feature", "geometry": mapping(g), "properties": props, "tippecanoe": {"minzoom": 14 if area[i] > BIG_M2 or ug[i] else 15}})
    n = write_geojsonseq(WORK / "layers" / "bld.geojsonseq", feats)
    print(f"buildings {n}, rectangles {int(use_rect.sum())}, with underground entrance {int(ug.sum())}, avg vertices {verts / max(n, 1):.1f}, entrance points {len(ent)}")


if __name__ == "__main__":
    main()
