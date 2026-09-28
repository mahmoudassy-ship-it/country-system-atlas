import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = path.resolve(process.env.SYSTEM_ATLAS_DATA_DIR ?? path.join(projectDirectory, "data"));
const backupDirectory = path.resolve(process.env.SYSTEM_ATLAS_BACKUP_DIR ?? path.join(dataDirectory, "backups"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const files = ["system-atlas.sqlite", "system-atlas-snapshot.json", "quality-audit.json", "refresh-status.json"];
await mkdir(backupDirectory, { recursive: true });
const manifest = { createdAt: new Date().toISOString(), files: [] };

for (const name of files) {
  const source = path.join(dataDirectory, name);
  try {
    await stat(source);
    const targetName = `${stamp}-${name}.gz`;
    const target = path.join(backupDirectory, targetName);
    await pipeline(createReadStream(source), createGzip({ level: 9 }), createWriteStream(target, { mode: 0o640 }));
    const bytes = await readFile(target);
    manifest.files.push({ name: targetName, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const manifestName = `${stamp}-manifest.json`;
await writeFile(path.join(backupDirectory, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o640 });

const entries = await Promise.all((await readdir(backupDirectory)).map(async (name) => ({ name, mtime: (await stat(path.join(backupDirectory, name))).mtimeMs })));
const cutoff = Date.now() - Number(process.env.SYSTEM_ATLAS_BACKUP_RETENTION_DAYS ?? 14) * 86_400_000;
await Promise.all(entries.filter((entry) => entry.mtime < cutoff).map((entry) => rm(path.join(backupDirectory, entry.name), { force: true })));

if (process.env.SYSTEM_ATLAS_R2_BUCKET) {
  for (const item of [...manifest.files.map((file) => file.name), manifestName]) {
    await new Promise((resolve, reject) => {
      const child = spawn("npx", ["wrangler", "r2", "object", "put", `${process.env.SYSTEM_ATLAS_R2_BUCKET}/${item}`, "--file", path.join(backupDirectory, item), "--remote"], { stdio: "inherit", cwd: projectDirectory, env: process.env });
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`R2 upload failed for ${item}`)));
      child.once("error", reject);
    });
  }
}
console.log(JSON.stringify({ backupDirectory, manifest: manifestName, files: manifest.files.length, offsite: Boolean(process.env.SYSTEM_ATLAS_R2_BUCKET) }));
