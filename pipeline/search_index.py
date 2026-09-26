import json
import unicodedata

from common import OUT, WORK, write_json


def nfkc(s):
    return unicodedata.normalize("NFKC", s or "").strip()


def main():
    rows = []
    seen = set()

    def add(name, kind, lon, lat, extra=""):
        name = nfkc(name)
        if not name:
            return
        key = (name, kind, round(lon, 3), round(lat, 3))
        if key in seen:
            return
        seen.add(key)
        rows.append([name, kind, round(lon, 5), round(lat, 5), extra])

    with open(WORK / "lite" / "station.geojsonseq", encoding="utf-8") as f:
        for line in f:
            x = json.loads(line)
            c = x["geometry"]["coordinates"]
            add(x["properties"].get("n"), "station", c[0], c[1], x["properties"].get("o") or "")
    with open(WORK / "lite" / "facility.geojsonseq", encoding="utf-8") as f:
        for line in f:
            x = json.loads(line)
            c = x["geometry"]["coordinates"]
            add(x["properties"].get("n"), x["properties"]["g"], c[0], c[1])
    net = json.loads((OUT / "network.json").read_text(encoding="utf-8"))
    nf = {k: i for i, k in enumerate(net["node_fields"])}
    for n in net["nodes"]:
        if n[nf["flags"]] & 2 and n[nf["ref"]]:
            st = n[nf["station"]] or ""
            add(f"{st} {n[nf['ref']]}".strip(), "exit", n[0], n[1], "出口")
    write_json(OUT / "search.json", rows)
    print("search rows", len(rows), round((OUT / "search.json").stat().st_size / 1e6, 2), "MB")


if __name__ == "__main__":
    main()
