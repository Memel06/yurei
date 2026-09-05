import { chmod, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

process.chdir(dirname(fileURLToPath(import.meta.url)));

const result = await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: "dist/yurei.mjs",
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);',
  },
  legalComments: "none",
  logLevel: "info",
  metafile: true,
});
await chmod("dist/yurei.mjs", 0o755);
await writeFile("dist/THIRD_PARTY_LICENSES.txt", await thirdPartyNotices(Object.keys(result.metafile.inputs)));
console.log("kit built → dist/yurei.mjs");

/** The bundle inlines its dependencies, so their license texts have to travel with it. */
async function thirdPartyNotices(inputs) {
  const roots = new Set();
  for (const input of inputs) {
    const parts = input.split("node_modules/");
    if (parts.length < 2) continue;
    const pkgPath = parts.at(-1).split("/");
    const name = pkgPath[0].startsWith("@") ? `${pkgPath[0]}/${pkgPath[1]}` : pkgPath[0];
    roots.add(resolve(parts.slice(0, -1).join("node_modules/"), "node_modules", name));
  }
  const sections = [];
  for (const root of [...roots].sort()) {
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const licenseFile = (await readdir(root)).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
    const text = licenseFile
      ? (await readFile(join(root, licenseFile), "utf8")).trim()
      : `License: ${pkg.license ?? "unknown"}`;
    sections.push(
      `${pkg.name} ${pkg.version}\n${"=".repeat(pkg.name.length + String(pkg.version).length + 1)}\n\n${text}`,
    );
  }
  return `Third-party software bundled in yurei-chrome\n\n${sections.join("\n\n\n")}\n`;
}
