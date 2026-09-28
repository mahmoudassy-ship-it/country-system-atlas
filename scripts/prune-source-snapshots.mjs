import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/source-snapshots");
const keep = Number(process.env.SYSTEM_ATLAS_SOURCE_SNAPSHOT_KEEP ?? 14);
for (const directory of await readdir(root, { withFileTypes: true })) {
  if (!directory.isDirectory()) continue;
  const location = path.join(root, directory.name);
  const files = await Promise.all((await readdir(location)).map(async (name) => ({ name, mtime: (await stat(path.join(location, name))).mtimeMs })));
  files.sort((a, b) => b.mtime - a.mtime);
  await Promise.all(files.slice(keep).map((file) => rm(path.join(location, file.name), { force: true })));
}
