import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import world from "@svg-maps/world";
import snapshot from "../data/system-atlas-snapshot.json" with { type: "json" };
import coreIndicatorCatalog from "../src/data/indicator-catalog.json" with { type: "json" };
import additionalIndicatorCatalog from "../src/data/additional-indicator-catalog.json" with { type: "json" };
import expandedIndicatorCatalog from "../src/data/expanded-indicator-catalog.json" with { type: "json" };
import sourceCatalog from "../src/data/source-catalog.json" with { type: "json" };

const indicators = [...coreIndicatorCatalog, ...additionalIndicatorCatalog, ...expandedIndicatorCatalog];
const currentYear = new Date().getUTCFullYear();
const startYear = currentYear - 14;
const issues = [];
const extraction = {};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += character;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift() ?? [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "System Atlas data quality audit/0.1" }, signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`Source returned ${response.status}: ${url}`);
  return response.text();
}

function normalizeIso3(code) {
  return code === "UVK" || code === "KOS" ? "XKX" : code;
}

const snapshotValues = new Map();
const snapshotCountryIds = new Set(snapshot.countries.map((country) => country.iso3));
for (const country of snapshot.countries) {
  for (const [indicatorId, history] of Object.entries(country.history)) {
    for (const observation of history) snapshotValues.set(`${country.iso3}|${indicatorId}|${observation.period}`, observation.value);
  }
}

function compare(sourceName, rows) {
  let compared = 0;
  let missing = 0;
  let different = 0;
  const examples = [];
  for (const row of rows) {
    if (!snapshotCountryIds.has(row.iso3) || !Number.isFinite(row.value)) continue;
    const actual = snapshotValues.get(`${row.iso3}|${row.indicatorId}|${row.period}`);
    compared += 1;
    if (actual === undefined) {
      missing += 1;
      if (examples.length < 5) examples.push({ kind: "missing", ...row });
    } else if (Math.abs(actual - row.value) > 1e-9) {
      different += 1;
      if (examples.length < 5) examples.push({ kind: "different", ...row, actual });
    }
  }
  extraction[sourceName] = { compared, missing, different, examples };
  if (missing || different) issues.push({ severity: "high", check: `${sourceName} extraction`, missing, different, examples });
}

const countryIso3 = snapshot.countries.map((country) => country.iso3);
const countryIso2 = snapshot.countries.map((country) => country.iso2);
const duplicateIso3 = countryIso3.filter((code, index) => countryIso3.indexOf(code) !== index);
const duplicateIso2 = countryIso2.filter((code, index) => countryIso2.indexOf(code) !== index);
if (duplicateIso3.length || duplicateIso2.length) issues.push({ severity: "critical", check: "country identifiers", duplicateIso3, duplicateIso2 });

const mapIds = new Set(world.locations.map((location) => location.id.toUpperCase()));
const mapMatched = snapshot.countries.filter((country) => mapIds.has(country.iso2));
const countriesWithoutShape = snapshot.countries.filter((country) => !mapIds.has(country.iso2)).map((country) => ({ iso3: country.iso3, iso2: country.iso2, name: country.name }));
const shapesWithoutProfile = world.locations.filter((location) => !new Set(countryIso2).has(location.id.toUpperCase())).map((location) => ({ iso2: location.id.toUpperCase(), name: location.name }));
if (countriesWithoutShape.length) issues.push({ severity: "low", check: "map matching", countriesWithoutShape });

const catalogIds = new Set(indicators.map((indicator) => indicator.id));
const sourceIds = new Set(sourceCatalog.map((source) => source.id));
const definitionProblems = indicators.filter((indicator) =>
  !sourceIds.has(indicator.sourceId) ||
  [indicator.definition, indicator.interpretation, indicator.whyItMatters, indicator.caveat].some((text) => !text || text.length < 30),
).map((indicator) => indicator.id);
if (definitionProblems.length) issues.push({ severity: "high", check: "indicator documentation", indicators: definitionProblems });
const snapshotCatalogMismatch = snapshot.indicators.map((indicator) => indicator.id).filter((id) => !catalogIds.has(id));
if (snapshotCatalogMismatch.length || snapshot.indicators.length !== indicators.length) {
  issues.push({ severity: "critical", check: "snapshot catalog", snapshotCatalogMismatch });
}

const boundedZeroToOne = new Set([
  "undp-hdi", "undp-ihdi", "undp-gii", "undp-phdi",
  ...indicators.filter((indicator) => indicator.sourceId === "international-idea-gsod").map((indicator) => indicator.id),
]);
const boundedZeroToHundred = new Set([
  "wb-gini", "wb-internet-use", "wb-electricity-access", "wb-youth-neet",
  "wb-labour-participation-female", "wb-labour-participation-male", "wb-primary-out-of-school",
  "wb-adult-literacy", "wb-learning-poverty", "wb-uhc-service-coverage", "wb-dpt-immunisation",
  "wb-poverty-3-dollar", "wb-multidimensional-poverty-headcount", "wb-women-parliament",
  "wb-safe-water", "wb-safe-sanitation", "wb-clean-cooking", "wb-renewable-energy-share", "wb-forest-area",
  "wgi-voice-accountability", "wgi-government-effectiveness", "wgi-rule-of-law", "wgi-control-corruption",
]);
const invalidValues = [];
const invalidPeriods = [];
const missingSourceUrls = [];
const invalidStatuses = [];
const invalidUncertainty = [];
for (const country of snapshot.countries) {
  for (const [indicatorId, history] of Object.entries(country.history)) {
    const periods = history.map((observation) => observation.period);
    if (periods.join("|") !== [...periods].sort().join("|")) invalidPeriods.push({ iso3: country.iso3, indicatorId, reason: "unsorted" });
    for (const observation of history) {
      if (!/^\d{4}$/.test(observation.period) || Number(observation.period) > currentYear) invalidPeriods.push({ iso3: country.iso3, indicatorId, period: observation.period });
      if (!Number.isFinite(observation.value)) invalidValues.push({ iso3: country.iso3, indicatorId, value: observation.value });
      if (boundedZeroToOne.has(indicatorId) && (observation.value < 0 || observation.value > 1)) invalidValues.push({ iso3: country.iso3, indicatorId, value: observation.value });
      if (boundedZeroToHundred.has(indicatorId) && (observation.value < 0 || observation.value > 100)) invalidValues.push({ iso3: country.iso3, indicatorId, value: observation.value });
      if (indicatorId === "vdem-regime-type" && (!Number.isInteger(observation.value) || observation.value < 0 || observation.value > 3)) invalidValues.push({ iso3: country.iso3, indicatorId, value: observation.value });
      if (!observation.sourceUrl) missingSourceUrls.push({ iso3: country.iso3, indicatorId, period: observation.period });
      const indicator = indicators.find((item) => item.id === indicatorId);
      if (!indicator || !["reported", "estimated", "modelled", "projected", "unknown"].includes(observation.status)) invalidStatuses.push({ iso3: country.iso3, indicatorId, status: observation.status });
      if (indicator?.sourceId.startsWith("world-bank-") && observation.status === "reported") invalidStatuses.push({ iso3: country.iso3, indicatorId, status: observation.status, reason: "World Bank API obs_status does not establish reported provenance" });
      if (observation.uncertainty && (observation.uncertainty.lower > observation.value || observation.uncertainty.upper < observation.value)) invalidUncertainty.push({ iso3: country.iso3, indicatorId, period: observation.period });
    }
    const latest = country.latest[indicatorId];
    if (!latest || JSON.stringify(latest) !== JSON.stringify(history.at(-1))) invalidPeriods.push({ iso3: country.iso3, indicatorId, reason: "latest mismatch" });
  }
}
if (invalidValues.length) issues.push({ severity: "critical", check: "value validity", count: invalidValues.length, examples: invalidValues.slice(0, 10) });
if (invalidPeriods.length) issues.push({ severity: "critical", check: "period/latest validity", count: invalidPeriods.length, examples: invalidPeriods.slice(0, 10) });
if (missingSourceUrls.length) issues.push({ severity: "medium", check: "observation provenance", count: missingSourceUrls.length, examples: missingSourceUrls.slice(0, 10) });
if (invalidStatuses.length) issues.push({ severity: "high", check: "observation status semantics", count: invalidStatuses.length, examples: invalidStatuses.slice(0, 10) });
if (invalidUncertainty.length) issues.push({ severity: "high", check: "uncertainty bounds", count: invalidUncertainty.length, examples: invalidUncertainty.slice(0, 10) });

const rosterProblems = snapshot.countries.filter((country) => !country.entityType || !country.rosterBasis).map((country) => country.iso3);
if (rosterProblems.length) issues.push({ severity: "high", check: "country/economy roster policy", countries: rosterProblems });
const sourceFreshnessProblems = snapshot.sources.filter((source) => !source.lastCheckedAt || !source.releaseLastUpdated || source.status !== "current").map((source) => source.id);
if (sourceFreshnessProblems.length) issues.push({ severity: "high", check: "source freshness metadata", sources: sourceFreshnessProblems });

const coverage = Object.fromEntries(indicators.map((indicator) => {
  const available = snapshot.countries.filter((country) => country.latest[indicator.id]).length;
  const years = snapshot.countries.map((country) => Number(country.latest[indicator.id]?.period)).filter(Number.isFinite);
  return [indicator.id, { available, percent: Number((available / snapshot.countries.length * 100).toFixed(1)), latestYear: years.length ? Math.max(...years) : null }];
}));

const worldBankDirectory = new URL("../data/source-snapshots/world-bank/", import.meta.url);
const worldBankFiles = (await readdir(worldBankDirectory)).filter((file) => file.endsWith(".json"));
const worldBankFilesByTime = await Promise.all(worldBankFiles.map(async (file) => ({
  file,
  mtime: (await stat(new URL(file, worldBankDirectory))).mtimeMs,
})));
worldBankFilesByTime.sort((left, right) => left.mtime - right.mtime);
const worldBankRaw = JSON.parse(await readFile(new URL(worldBankFilesByTime.at(-1).file, worldBankDirectory), "utf8"));
const worldBankByCode = new Map(indicators.filter((indicator) => indicator.sourceId.startsWith("world-bank-")).map((indicator) => [indicator.sourceIndicatorId, indicator.id]));
const wbRows = [];
for (const [sourceIndicatorId, payload] of Object.entries(worldBankRaw.rawByIndicator)) {
  const indicatorId = worldBankByCode.get(sourceIndicatorId);
  if (!indicatorId) continue;
  for (const row of payload[1] ?? []) {
    if (row.value === null || !snapshot.countries.some((country) => country.iso3 === row.countryiso3code)) continue;
    wbRows.push({ iso3: row.countryiso3code, indicatorId, period: row.date, value: Number(row.value) });
  }
}
compare("World Bank", wbRows);

const undpFiles = (await readdir(new URL("../data/source-snapshots/undp/", import.meta.url))).filter((file) => file.endsWith(".csv")).sort();
const undpRows = parseCsv(await readFile(new URL(`../data/source-snapshots/undp/${undpFiles.at(-1)}`, import.meta.url), "utf8"));
const undpComparisons = [];
for (const row of undpRows) for (const indicator of indicators.filter((item) => item.sourceId === "undp-hdro")) {
  for (let year = startYear; year <= currentYear; year += 1) {
    const rawValue = row[`${indicator.sourceIndicatorId}_${year}`];
    if (rawValue === undefined || rawValue === "") continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || !snapshot.countries.some((country) => country.iso3 === row.iso3)) continue;
    undpComparisons.push({ iso3: row.iso3, indicatorId: indicator.id, period: String(year), value });
  }
}
compare("UNDP", undpComparisons);

async function latestFile(directoryUrl, extension) {
  const files = (await readdir(directoryUrl)).filter((file) => file.endsWith(extension));
  const timed = await Promise.all(files.map(async (file) => ({ file, mtime: (await stat(new URL(file, directoryUrl))).mtimeMs })));
  timed.sort((a, b) => a.mtime - b.mtime);
  if (!timed.length) throw new Error(`No archived ${extension} source in ${directoryUrl.pathname}`);
  return new URL(timed.at(-1).file, directoryUrl);
}
const ideaRows = parseCsv(await readFile(await latestFile(new URL("../data/source-snapshots/international-idea/", import.meta.url), ".csv"), "utf8"));
const ideaComparisons = [];
for (const row of ideaRows) for (const indicator of indicators.filter((item) => item.sourceId === "international-idea-gsod")) {
  const value = Number(row[indicator.sourceIndicatorId]);
  if (!Number.isFinite(value) || Number(row.year) < startYear || Number(row.year) > currentYear) continue;
  ideaComparisons.push({ iso3: normalizeIso3(row.iso3c), indicatorId: indicator.id, period: row.year, value });
}
compare("International IDEA", ideaComparisons);

const regimeRows = parseCsv(await readFile(await latestFile(new URL("../data/source-snapshots/owid-vdem/", import.meta.url), ".csv"), "utf8"));
compare("V-Dem regime classification", regimeRows.filter((row) => Number(row.Year) >= startYear && Number(row.Year) <= currentYear).map((row) => ({
  iso3: normalizeIso3(row.Code), indicatorId: "vdem-regime-type", period: row.Year, value: Number(row["Political regime"]),
})));

const imfComparisons = [];
const imfArchive = JSON.parse(await readFile(await latestFile(new URL("../data/source-snapshots/imf/", import.meta.url), ".json"), "utf8"));
await Promise.all(indicators.filter((indicator) => indicator.sourceId === "imf-gdd").map(async (indicator) => {
  const payload = imfArchive[indicator.sourceIndicatorId];
  for (const [rawIso3, periods] of Object.entries(payload.values?.[indicator.sourceIndicatorId] ?? {})) {
    for (const [period, value] of Object.entries(periods)) {
      if (Number(period) < startYear || Number(period) > currentYear) continue;
      imfComparisons.push({ iso3: normalizeIso3(rawIso3), indicatorId: indicator.id, period, value: Number(value) });
    }
  }
}));
compare("IMF", imfComparisons);

const report = {
  generatedAt: new Date().toISOString(),
  status: issues.some((issue) => issue.severity === "critical" || issue.severity === "high") ? "failed" : "passed_with_notes",
  scope: { countries: snapshot.countries.length, indicators: indicators.length, sources: sourceCatalog.length, observationValues: snapshotValues.size },
  roster: {
    uniqueIso3: new Set(countryIso3).size,
    uniqueIso2: new Set(countryIso2).size,
    mapMatched: mapMatched.length,
    countriesWithoutShape,
    shapesWithoutProfile,
  },
  coverage,
  extraction,
  documentation: { complete: indicators.length - definitionProblems.length, total: indicators.length },
  issues,
};
await writeFile(new URL("../data/quality-audit.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, scope: report.scope, roster: report.roster, extraction: report.extraction, issues: issues.length }, null, 2));
if (report.status === "failed") process.exitCode = 1;
