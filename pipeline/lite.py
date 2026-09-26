import json
import subprocess

from common import ROOT, WORK, write_geojsonseq

L = WORK / "layers"
OUT = WORK / "lite"
CLIP = "139.54,35.50,139.94,35.83"

ROAD = {"motorway": (1, 10), "trunk": (2, 10), "primary": (3, 10), "secondary": (4, 11), "tertiary": (5, 12), "minor": (6, 13), "service": (7, 14), "path": (8, 15)}
RAIL = {"rail": 1, "subway": 2, "light_rail": 3, "monorail": 4, "tram": 5, "narrow_gauge": 1, "funicular": 5}


def read(name):
    with open(L / f"{name}.geojsonseq", encoding="utf-8") as f:
        for line in f:
            yield json.loads(line)


def out(name, feats):
    return write_geojsonseq(OUT / f"{name}.geojsonseq", feats)


def f(geom, props, minzoom):
    return {"type": "Feature", "geometry": geom, "properties": {k: v for k, v in props.items() if v not in (None, "", 0)}, "tippecanoe": {"minzoom": minzoom}}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    counts = {}
    counts["road"] = out("road", (f(x["geometry"], {"c": ROAD[x["properties"]["class"]][0], "n": x["properties"].get("name") if ROAD[x["properties"]["class"]][0] <= 5 else None, "t": x["properties"].get("tunnel")}, ROAD[x["properties"]["class"]][1]) for x in read("road")))
    counts["rail"] = out("rail", (f(x["geometry"], {"k": RAIL.get(x["properties"]["kind"], 1), "c": x["properties"].get("colour"), "t": x["properties"].get("tunnel"), "s": 1 if x["properties"].get("service") else 0}, 13 if x["properties"].get("service") else 10) for x in read("rail")))
    counts["water"] = out("water", (f(x["geometry"], {}, 10 if x["properties"].get("kind") == "sea" else 11) for x in read("water")))
    counts["waterway"] = out("waterway", (f(x["geometry"], {"r": 1 if x["properties"].get("kind") in ("river", "canal") else 0}, 11 if x["properties"].get("kind") in ("river", "canal") else 14) for x in read("waterway")))
    counts["park"] = out("park", (f(x["geometry"], {}, 13) for x in read("green") if x["properties"].get("kind") in ("park", "garden", "cemetery", "golf_course", "forest", "wood", "grass", "recreation_ground")))
    counts["block"] = out("block", (f(x["geometry"], {}, 15) for x in read("block")))
    counts["ward"] = out("ward", (f(x["geometry"], {"n": x["properties"]["name"]}, 10) for x in read("ward")))
    counts["wlabel"] = out("wlabel", (f(x["geometry"], {"n": x["properties"]["name"]}, 10) for x in read("ward_label")))
    counts["place"] = out("place", (f(x["geometry"], {"n": x["properties"].get("name"), "k": 1 if x["properties"]["kind"] in ("suburb", "town", "city") else 2}, 13 if x["properties"]["kind"] in ("suburb", "town", "city") else 15) for x in read("place") if x["properties"].get("name")))
    counts["station"] = out("station", (f(x["geometry"], {"n": x["properties"]["name"], "o": x["properties"].get("operator"), "s": x["properties"].get("subway")}, 10) for x in read("station")))
    counts["bus"] = out("bus", (f(x["geometry"], {"n": x["properties"].get("n"), "r": x["properties"].get("routes")}, 12) for x in read("bus_route")))
    counts["bstop"] = out("bstop", (f(x["geometry"], {"n": x["properties"].get("name")}, 15) for x in read("bus_stop") if x["properties"].get("kind") == "bus_stop"))
    counts["ferry"] = out("ferry", (f(x["geometry"], {"n": x["properties"].get("name"), "k": 1 if x["properties"]["kind"] == "ferry_terminal" else 0}, 10) for x in read("ferry")))
    fac = []
    for x in read("facility"):
        p = x["properties"]
        mz = min(15, x.get("tippecanoe", {}).get("minzoom", 15))
        fac.append(f(x["geometry"], {"n": p.get("name"), "g": p["group"], "s": p.get("sub"), "a": p.get("admin"), "src": p.get("src"), "r": p.get("ref"), "ad": p.get("addr"), "w": p.get("website"), "h": p.get("hours"), "co": p.get("country")}, mz))
    counts["facility"] = out("facility", fac)
    print(counts)
    args = ["tippecanoe", "-o", str(ROOT / "docs" / "data" / "map.pmtiles"), "--force", "-Z10", "-z15", f"--clip-bounding-box={CLIP}",
            "--no-tile-stats", "--simplification=6", "--drop-densest-as-needed", "-q"]
    for name in counts:
        args += ["-L", f"{name}:{OUT / (name + '.geojsonseq')}"]
    subprocess.run(args, check=True)
    size = (ROOT / "docs" / "data" / "map.pmtiles").stat().st_size
    print("map.pmtiles", round(size / 1e6, 1), "MB")


if __name__ == "__main__":
    main()
