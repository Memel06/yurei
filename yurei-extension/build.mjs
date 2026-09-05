import { cp, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

process.chdir(dirname(fileURLToPath(import.meta.url)));

await rm("dist", { recursive: true, force: true });

const common = { bundle: true, target: "chrome120", logLevel: "info", legalComments: "none" };

await build({ ...common, entryPoints: ["src/background.ts"], format: "esm", outfile: "dist/background.js" });
await build({
  ...common,
  entryPoints: {
    "content/indicator": "src/content/indicator.ts",
    "content/page-tools": "src/content/page-tools.ts",
    popup: "src/popup/popup.ts",
  },
  format: "iife",
  outdir: "dist",
});

await cp("manifest.json", "dist/manifest.json");
await cp("src/popup/popup.html", "dist/popup.html");
await cp("icons", "dist/icons", { recursive: true });
await cp("fonts", "dist/fonts", { recursive: true });
console.log("extension built → dist/");
