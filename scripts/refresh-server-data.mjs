import { spawn } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";

const statusUrl = new URL("../data/refresh-status.json", import.meta.url);
const snapshotUrl = new URL("../data/system-atlas-snapshot.json", import.meta.url);
let previousChecksum = "";
try { previousChecksum = JSON.parse(await readFile(snapshotUrl, "utf8")).contentChecksum ?? ""; } catch {}

async function writeStatus(status) {
  const temporary = new URL(`../data/refresh-status.json.next-${process.pid}`, import.meta.url);
  await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`);
  await rename(temporary, statusUrl);
}

async function notifyFailure(message) {
  if (!process.env.SYSTEM_ATLAS_ALERT_WEBHOOK_URL) return;
  await fetch(process.env.SYSTEM_ATLAS_ALERT_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ service: "system-atlas-refresh", status: "failed", message, occurredAt: new Date().toISOString() }),
    signal: AbortSignal.timeout(15_000),
  });
}

const commands = [
  ["npm", ["run", "data:atlas"]],
  ["npm", ["run", "data:audit"]],
  ["npm", ["run", "server:db"]],
];

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed (${signal ?? `exit ${code}`})`));
    });
  });
}

try {
  await writeStatus({ status: "running", startedAt: new Date().toISOString() });
  for (const [index, [command, args]] of commands.entries()) {
    await run(command, args);
    if (index === commands.length - 1) await writeStatus({ status: "running", stage: "database-published", startedAt: new Date().toISOString() });
  }
  const snapshot = JSON.parse(await readFile(snapshotUrl, "utf8"));
  const contentChanged = previousChecksum !== snapshot.contentChecksum;
  let pagesDeployed = false;
  if (contentChanged && process.env.SYSTEM_ATLAS_DEPLOY_PAGES === "1") {
    await run("npm", ["run", "build"]);
    await run("npx", ["wrangler", "pages", "deploy", "dist", "--project-name", "country-system-atlas"]);
    pagesDeployed = true;
  }
  await writeStatus({
    status: "succeeded",
    stage: "database-published",
    completedAt: new Date().toISOString(),
    generatedAt: snapshot.generatedAt,
    contentChecksum: snapshot.contentChecksum,
    contentChanged,
    pagesDeployed,
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  let prior = {};
  try { prior = JSON.parse(await readFile(statusUrl, "utf8")); } catch {}
  await writeStatus({ status: "failed", stage: prior.stage ?? "before-publish", completedAt: new Date().toISOString(), message });
  try { await notifyFailure(message); } catch (notificationError) { console.error("Alert delivery failed", notificationError); }
  throw error;
}
