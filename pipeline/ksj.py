import urllib.request
import zipfile

from common import WORK

BASE = "https://nlftp.mlit.go.jp/ksj/gml/data/"
FILES = [
    "P05/P05-22/P05-22_13_GML.zip",
    "P28/P28-22/P28-22_13.zip",
    "P29/P29-23/P29-23_13_GML.zip",
    "P14/P14-23/P14-23_13_GML.zip",
    "P04/P04-20/P04-20_13_GML.zip",
    "P27/P27-13/P27-13_13.zip",
    "P30/P30-13/P30-13_13.zip",
    "P17/P17-12/P17-12_13_GML.zip",
    "P18/P18-12/P18-12_13_GML.zip",
]


def main():
    out = WORK / "ksj"
    out.mkdir(parents=True, exist_ok=True)
    for rel in FILES:
        name = rel.rsplit("/", 1)[1]
        z = out / name
        if not z.exists():
            urllib.request.urlretrieve(BASE + rel, z)
        with zipfile.ZipFile(z) as f:
            for info in f.infolist():
                info.filename = info.filename.replace("\\", "/")
                f.extract(info, out / name.removesuffix(".zip"))
        print("ok", name)


if __name__ == "__main__":
    main()
