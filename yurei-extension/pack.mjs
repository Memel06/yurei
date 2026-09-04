import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
process.chdir(here);

async function pack(name, edit) {
  const stage = await mkdtemp(join(tmpdir(), "yurei-pack-"));
  await cp("dist", stage, { recursive: true });
  const manifestPath = join(stage, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await writeFile(manifestPath, JSON.stringify(edit(manifest), null, 2) + "\n");
  await rm(name, { force: true });
  execFileSync("zip", ["-qr", join(here, name), "."], { cwd: stage });
  await rm(stage, { recursive: true, force: true });
  console.log(`packed → ${name}`);
}

// The `key` pins the id an unpacked folder gets, which the native host trusts. The Chrome Web Store
// minted its own id for the listing and refuses any upload that carries a key, so the store build drops it.
await pack("yurei-extension.zip", (manifest) => manifest);
await pack("yurei-extension-store.zip", ({ key, ...manifest }) => manifest);
