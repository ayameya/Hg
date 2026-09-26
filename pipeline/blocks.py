import json
import math
from multiprocessing import Pool

import numpy as np
import shapely
from shapely.geometry import box, mapping, shape

from common import WORK, write_geojsonseq

CLIP = (139.54, 35.50, 139.94, 35.83)
CELL = 0.01
GROW = 0.000018
SIMPLIFY = 0.000015
MIN_AREA = 2.5e-9


def load():
    geoms = []
    with open(WORK / "layers" / "building.geojsonseq", encoding="utf-8") as f:
        for line in f:
            g = shape(json.loads(line)["geometry"])
            c = g.centroid
            if CLIP[0] <= c.x <= CLIP[2] and CLIP[1] <= c.y <= CLIP[3]:
                geoms.append(g)
    return np.array(geoms, dtype=object)


def work(args):
    cell, geoms = args
    if len(geoms) == 0:
        return []
    grown = shapely.buffer(shapely.make_valid(geoms), GROW, quad_segs=1, join_style="mitre")
    try:
        merged = shapely.union_all(grown)
    except shapely.errors.GEOSException:
        merged = shapely.union_all(shapely.buffer(grown, 0))
    shrunk = shapely.buffer(merged, -GROW, quad_segs=1, join_style="mitre")
    clipped = shapely.make_valid(shrunk).intersection(cell)
    simple = shapely.simplify(clipped, SIMPLIFY, preserve_topology=True)
    parts = list(getattr(simple, "geoms", [simple]))
    return [mapping(p) for p in parts if p.geom_type == "Polygon" and p.area >= MIN_AREA]


def main():
    geoms = load()
    cents = shapely.centroid(geoms)
    xs = shapely.get_x(cents)
    ys = shapely.get_y(cents)
    tasks = []
    nx = math.ceil((CLIP[2] - CLIP[0]) / CELL)
    ny = math.ceil((CLIP[3] - CLIP[1]) / CELL)
    ix = ((xs - CLIP[0]) / CELL).astype(int)
    iy = ((ys - CLIP[1]) / CELL).astype(int)
    order = np.lexsort((iy, ix))
    keys = ix[order] * ny + iy[order]
    bounds = np.flatnonzero(np.diff(keys)) + 1
    for chunk in np.split(order, bounds):
        k = ix[chunk[0]], iy[chunk[0]]
        cell = box(CLIP[0] + k[0] * CELL, CLIP[1] + k[1] * CELL, CLIP[0] + (k[0] + 1) * CELL, CLIP[1] + (k[1] + 1) * CELL)
        pad = cell.buffer(GROW * 4)
        sel = geoms[chunk]
        tasks.append((cell, sel[shapely.intersects(sel, pad)]))
    with Pool(4) as pool:
        results = pool.map(work, tasks, chunksize=4)
    feats = []
    for polys in results:
        for g in polys:
            feats.append({"type": "Feature", "geometry": g, "properties": {}, "tippecanoe": {"minzoom": 14}})
    n = write_geojsonseq(WORK / "layers" / "block.geojsonseq", feats)
    print("buildings", len(geoms), "-> blocks", n, "cells", len(tasks), nx * ny)


if __name__ == "__main__":
    main()
