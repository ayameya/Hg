import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "docs");
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(here, "src", "app.js")],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  outfile: join(out, "app.js"),
  legalComments: "none",
});

cpSync(join(here, "index.html"), join(out, "index.html"));
cpSync(join(here, "app.css"), join(out, "app.css"));
console.log("built", out);
