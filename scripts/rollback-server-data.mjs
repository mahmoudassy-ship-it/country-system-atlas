import { copyFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.resolve(process.env.SYSTEM_ATLAS_DB_PATH ?? path.join(projectDirectory, "data/system-atlas.sqlite"));
const previous = `${target}.previous`;
const statusPath = path.join(projectDirectory, "data/refresh-status.json");
const status = JSON.parse(await readFile(statusPath, "utf8"));
if (status.stage !== "database-published") {
  console.error("Refresh failed before database publication; the active database was not changed.");
  process.exit(0);
}
await stat(previous);
await copyFile(previous, target);
console.error(`Restored ${previous} to ${target}`);
