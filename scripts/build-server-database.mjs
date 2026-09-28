import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = process.env.SYSTEM_ATLAS_SNAPSHOT_PATH
  ? path.resolve(process.env.SYSTEM_ATLAS_SNAPSHOT_PATH)
  : path.join(projectDirectory, "data", "system-atlas-snapshot.json");
const targetPath = path.resolve(process.argv[2] ?? path.join(projectDirectory, "data", "system-atlas.sqlite"));
const nextPath = `${targetPath}.next-${process.pid}`;
const previousPath = `${targetPath}.previous`;
const serializedSnapshot = await readFile(snapshotPath, "utf8");
const snapshot = JSON.parse(serializedSnapshot);

if (snapshot.countries.length !== 219 || snapshot.indicators.length !== 71 || snapshot.sources.length !== 7) {
  throw new Error(`Refusing to publish incomplete data (${snapshot.countries.length} countries, ${snapshot.indicators.length} indicators, ${snapshot.sources.length} sources)`);
}

await mkdir(path.dirname(targetPath), { recursive: true });
await rm(nextPath, { force: true });
const database = new DatabaseSync(nextPath);
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = DELETE;
  PRAGMA synchronous = FULL;

  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) WITHOUT ROWID;

  CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    json TEXT NOT NULL
  ) WITHOUT ROWID;

  CREATE TABLE indicators (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id),
    display_order INTEGER NOT NULL,
    json TEXT NOT NULL
  ) WITHOUT ROWID;

  CREATE TABLE countries (
    iso3 TEXT PRIMARY KEY,
    iso2 TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    profile_json TEXT NOT NULL
  ) WITHOUT ROWID;

  CREATE TABLE observations (
    country_iso3 TEXT NOT NULL REFERENCES countries(iso3),
    indicator_id TEXT NOT NULL REFERENCES indicators(id),
    period TEXT NOT NULL,
    value REAL NOT NULL,
    observation_status TEXT NOT NULL,
    source_url TEXT,
    uncertainty_json TEXT,
    PRIMARY KEY (country_iso3, indicator_id, period)
  ) WITHOUT ROWID;

  CREATE INDEX observations_by_indicator
    ON observations(indicator_id, period DESC, country_iso3);
`);

const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
const insertMetadata = database.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)");
const insertSource = database.prepare("INSERT INTO sources (id, json) VALUES (?, ?)");
const insertIndicator = database.prepare("INSERT INTO indicators (id, source_id, display_order, json) VALUES (?, ?, ?, ?)");
const insertCountry = database.prepare("INSERT INTO countries (iso3, iso2, name, summary_json, profile_json) VALUES (?, ?, ?, ?, ?)");
const insertObservation = database.prepare(`
  INSERT INTO observations (
    country_iso3, indicator_id, period, value, observation_status, source_url, uncertainty_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);

database.exec("BEGIN IMMEDIATE");
try {
  const checksum = createHash("sha256").update(serializedSnapshot).digest("hex");
  for (const [key, value] of Object.entries({
    generated_at: snapshot.generatedAt,
    upstream_last_updated: snapshot.source.lastUpdated ?? "",
    snapshot_checksum: checksum,
    content_checksum: snapshot.contentChecksum ?? "",
    schema_version: String(snapshot.schemaVersion),
  })) insertMetadata.run(key, value);

  for (const source of snapshot.sources) insertSource.run(source.id, JSON.stringify(source));
  for (const indicator of snapshot.indicators) {
    const source = sourceById.get(indicator.sourceId);
    if (!source) throw new Error(`Indicator ${indicator.id} references unknown source ${indicator.sourceId}`);
    const enriched = {
      ...indicator,
      sourceName: source.name,
      sourceHomepageUrl: source.homepageUrl,
      sourceMethodologyUrl: source.methodologyUrl,
      sourceLicenseName: source.licenseName,
      sourceLicenseUrl: source.licenseUrl,
    };
    insertIndicator.run(indicator.id, indicator.sourceId, indicator.displayOrder, JSON.stringify(enriched));
  }

  for (const country of snapshot.countries) {
    const { history, ...summary } = country;
    insertCountry.run(country.iso3, country.iso2, country.name, JSON.stringify(summary), JSON.stringify(country));
    for (const [indicatorId, observations] of Object.entries(history)) {
      for (const observation of observations) {
        insertObservation.run(
          country.iso3,
          indicatorId,
          observation.period,
          observation.value,
          observation.status,
          observation.sourceUrl ?? null,
          observation.uncertainty ? JSON.stringify(observation.uncertainty) : null,
        );
      }
    }
  }
  database.exec("COMMIT");
} catch (error) {
  database.exec("ROLLBACK");
  database.close();
  await rm(nextPath, { force: true });
  throw error;
}

database.exec("PRAGMA optimize");
const integrity = database.prepare("PRAGMA integrity_check").get().integrity_check;
const counts = {
  countries: database.prepare("SELECT COUNT(*) AS count FROM countries").get().count,
  indicators: database.prepare("SELECT COUNT(*) AS count FROM indicators").get().count,
  sources: database.prepare("SELECT COUNT(*) AS count FROM sources").get().count,
  observations: database.prepare("SELECT COUNT(*) AS count FROM observations").get().count,
};
database.close();

if (integrity !== "ok" || counts.countries !== 219 || counts.indicators !== 71 || counts.sources !== 7) {
  await rm(nextPath, { force: true });
  throw new Error(`Database validation failed: ${JSON.stringify({ integrity, counts })}`);
}

await rm(previousPath, { force: true });
try {
  await rename(targetPath, previousPath);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
try {
  await rename(nextPath, targetPath);
} catch (error) {
  try { await rename(previousPath, targetPath); } catch {}
  throw error;
}

console.log(JSON.stringify({ database: targetPath, integrity, counts, generatedAt: snapshot.generatedAt }, null, 2));
