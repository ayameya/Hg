import gzip
import os
import sys


def project_root():
    try:
        Import("env")
        return env.subst("$PROJECT_DIR")
    except NameError:
        return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def render(data):
    lines = []
    for i in range(0, len(data), 20):
        lines.append("  " + ", ".join(f"0x{b:02x}" for b in data[i:i + 20]) + ",")
    body = "\n".join(lines)
    return (
        "#pragma once\n\n"
        "#include <Arduino.h>\n"
        "#include <stddef.h>\n"
        "#include <stdint.h>\n\n"
        f"static const uint8_t kIndexHtmlGz[] PROGMEM = {{\n{body}\n}};\n"
        f"static const size_t kIndexHtmlGzLen = {len(data)};\n"
    )


def embed(root, out_dir=None):
    source = os.path.join(root, "web", "index.html")
    out_dir = out_dir or os.path.join(root, "src", "generated")
    target = os.path.join(out_dir, "index_html.h")
    with open(source, "rb") as f:
        html = f.read()
    data = gzip.compress(html, compresslevel=9, mtime=0)
    text = render(data)
    os.makedirs(out_dir, exist_ok=True)
    if os.path.exists(target):
        with open(target, "r", encoding="ascii") as f:
            if f.read() == text:
                return target, len(html), len(data)
    with open(target, "w", encoding="ascii", newline="\n") as f:
        f.write(text)
    return target, len(html), len(data)


root_dir = project_root()
output_dir = sys.argv[1] if __name__ == "__main__" and len(sys.argv) > 1 else None
header, raw_size, packed_size = embed(root_dir, output_dir)
print(f"embed_web: {header} ({raw_size} -> {packed_size} bytes gzip)")
