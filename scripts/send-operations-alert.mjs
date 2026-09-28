import { readFile } from "node:fs/promises";

const statusPath = process.env.SYSTEM_ATLAS_REFRESH_STATUS_PATH ?? "/srv/system-atlas/data/refresh-status.json";
let status = { status: "failed", message: "System Atlas refresh or publication verification failed." };
try { status = JSON.parse(await readFile(statusPath, "utf8")); } catch {}
const payload = {
  service: "system-atlas-refresh",
  status: "failed",
  message: status.message ?? "Post-publication verification failed; automatic rollback was requested.",
  stage: status.stage,
  occurredAt: new Date().toISOString(),
};
if (!process.env.SYSTEM_ATLAS_ALERT_WEBHOOK_URL) {
  console.error(`No alert webhook is configured: ${JSON.stringify(payload)}`);
  process.exit(0);
}
const response = await fetch(process.env.SYSTEM_ATLAS_ALERT_WEBHOOK_URL, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error(`Alert webhook returned ${response.status}`);
