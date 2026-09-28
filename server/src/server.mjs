import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const databasePath = process.env.SYSTEM_ATLAS_DB_PATH
  ? path.resolve(process.env.SYSTEM_ATLAS_DB_PATH)
  : path.join(projectDirectory, "data", "system-atlas.sqlite");
const port = Number(process.env.PORT || 3001);
const database = new DatabaseSync(databasePath, { readOnly: true });

database.exec("PRAGMA query_only = ON; PRAGMA foreign_keys = ON");

const metadata = Object.fromEntries(
  database.prepare("SELECT key, value FROM metadata").all().map((row) => [row.key, row.value]),
);
const sourceRows = database.prepare("SELECT json FROM sources ORDER BY id").all();
const indicatorRows = database.prepare("SELECT json FROM indicators ORDER BY display_order, id").all();
const countryRows = database.prepare("SELECT summary_json FROM countries ORDER BY name, iso3").all();
const countryByIso3 = database.prepare("SELECT profile_json FROM countries WHERE iso3 = ?");
const sources = sourceRows.map((row) => JSON.parse(row.json));
const indicators = indicatorRows.map((row) => JSON.parse(row.json));
const countries = countryRows.map((row) => JSON.parse(row.summary_json));
const countriesBody = JSON.stringify({ countries });
const indicatorsBody = JSON.stringify({ indicators });
const counts = {
  countries: database.prepare("SELECT COUNT(*) AS count FROM countries").get().count,
  indicators: database.prepare("SELECT COUNT(*) AS count FROM indicators").get().count,
  sources: database.prepare("SELECT COUNT(*) AS count FROM sources").get().count,
  observations: database.prepare("SELECT COUNT(*) AS count FROM observations").get().count,
};
const catalogReady = counts.countries === 219 && counts.indicators === 71 && counts.sources === 7;
const refreshStatusPath = process.env.SYSTEM_ATLAS_REFRESH_STATUS_PATH
  ? path.resolve(process.env.SYSTEM_ATLAS_REFRESH_STATUS_PATH)
  : path.join(projectDirectory, "data", "refresh-status.json");

function currentRefreshStatus() {
  try { return JSON.parse(readFileSync(refreshStatusPath, "utf8")); }
  catch { return { status: "unknown", completedAt: metadata.generated_at }; }
}

function headers(contentType = "application/json; charset=utf-8", cacheControl = "public, max-age=300, stale-while-revalidate=3600") {
  return {
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": cacheControl,
    "Content-Type": contentType,
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
  };
}

function send(response, status, body, responseHeaders = headers(), headOnly = false) {
  response.writeHead(status, responseHeaders);
  response.end(headOnly ? undefined : body);
}

function sendJson(response, status, payload, cacheControl) {
  send(response, status, JSON.stringify(payload), headers("application/json; charset=utf-8", cacheControl));
}

const server = http.createServer((request, response) => {
  if (request.method === "OPTIONS") {
    return send(response, 204, "", headers("text/plain; charset=utf-8", "no-store"));
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return sendJson(response, 405, { error: "Method not allowed" }, "no-store");
  }

  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/health" || url.pathname === "/api/health") {
    const latestRun = currentRefreshStatus();
    const completedAt = Date.parse(latestRun.completedAt ?? metadata.generated_at);
    const ageHours = Number.isFinite(completedAt) ? (Date.now() - completedAt) / 3_600_000 : Infinity;
    const freshness = ageHours <= 48 ? "current" : ageHours <= 96 ? "delayed" : "stale";
    const ready = catalogReady && freshness !== "stale";
    return sendJson(response, ready ? 200 : 503, {
      ok: ready,
      environment: "production",
      ready,
      servingMode: "server-sqlite",
      catalogTarget: { countries: 219, indicators: 71, sources: 7 },
      liveCounts: counts,
      generatedAt: metadata.generated_at,
      upstreamLastUpdated: metadata.upstream_last_updated || null,
      snapshotChecksum: metadata.snapshot_checksum,
      contentChecksum: metadata.content_checksum || null,
      freshness,
      ageHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(1)) : null,
      latestRun,
      degraded: latestRun.status === "failed" || freshness === "delayed",
      checkedAt: new Date().toISOString(),
    }, "no-store");
  }

  if (url.pathname === "/api/countries") {
    return send(response, 200, countriesBody, headers(), request.method === "HEAD");
  }
  if (url.pathname === "/api/indicators") {
    return send(response, 200, indicatorsBody, headers(), request.method === "HEAD");
  }

  const countryMatch = url.pathname.match(/^\/api\/countries\/([A-Za-z0-9]{3})$/);
  if (countryMatch) {
    const row = countryByIso3.get(countryMatch[1].toUpperCase());
    if (!row) return sendJson(response, 404, { error: "Country profile not found" }, "no-store");
    return sendJson(response, 200, { country: JSON.parse(row.profile_json), indicators });
  }

  return sendJson(response, 404, { error: "Not found" }, "no-store");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`System Atlas API listening on http://127.0.0.1:${port} with ${counts.countries} countries and ${counts.indicators} indicators`);
});

function close() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
