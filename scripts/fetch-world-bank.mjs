import { mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import coreIndicatorCatalog from "../src/data/indicator-catalog.json" with { type: "json" };
import additionalIndicatorCatalog from "../src/data/additional-indicator-catalog.json" with { type: "json" };
import expandedIndicatorCatalog from "../src/data/expanded-indicator-catalog.json" with { type: "json" };
import sourceCatalog from "../src/data/source-catalog.json" with { type: "json" };

const API_BASE = "https://api.worldbank.org/v2";
const UNDP_DOWNLOADS_URL = "https://hdr.undp.org/data-center/documentation-and-downloads";
const IDEA_INDEX_URL = "https://www.idea.int/democracytracker/gsod-indices";
const REGIME_CSV_URL = "https://ourworldindata.org/grapher/political-regime.csv?v=1&csvType=full&useColumnShortNames=false&external_link=true";
const IMF_API_BASE_URL = "https://www.imf.org/external/datamapper/api/v2";
const START_YEAR = new Date().getUTCFullYear() - 14;
const END_YEAR = new Date().getUTCFullYear();
const outputPath = new URL("../data/system-atlas-snapshot.json", import.meta.url);
const publicIndexPath = new URL("../public/data/atlas-index.json", import.meta.url);
const publicProfilesDirectory = new URL("../public/data/countries/", import.meta.url);
const rawDirectory = new URL("../data/source-snapshots/world-bank/", import.meta.url);
const undpRawDirectory = new URL("../data/source-snapshots/undp/", import.meta.url);
const ideaRawDirectory = new URL("../data/source-snapshots/international-idea/", import.meta.url);
const regimeRawDirectory = new URL("../data/source-snapshots/owid-vdem/", import.meta.url);
const imfRawDirectory = new URL("../data/source-snapshots/imf/", import.meta.url);
const deliverySource = sourceCatalog.find((source) => source.id === "world-bank-api");
if (!deliverySource) throw new Error("World Bank API source metadata is missing");
const indicatorCatalog = [...coreIndicatorCatalog, ...additionalIndicatorCatalog, ...expandedIndicatorCatalog];
const worldBankIndicators = indicatorCatalog.filter((indicator) => indicator.sourceId.startsWith("world-bank-"));
const undpIndicators = indicatorCatalog.filter((indicator) => indicator.sourceId === "undp-hdro");
const ideaIndicators = indicatorCatalog.filter((indicator) => indicator.sourceId === "international-idea-gsod");
const regimeIndicators = indicatorCatalog.filter((indicator) => indicator.sourceId === "owid-vdem");
const imfIndicators = indicatorCatalog.filter((indicator) => indicator.sourceId === "imf-gdd");

function defaultObservationStatus(indicator) {
  if (indicator.sourceId === "international-idea-gsod" || indicator.sourceId === "owid-vdem" || indicator.sourceId === "world-bank-wgi") return "modelled";
  if (indicator.sourceId === "undp-hdro") return "modelled";
  if (/modelled|estimated/i.test(`${indicator.definition} ${indicator.caveat}`)) return "modelled";
  return "unknown";
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "System Atlas data pipeline/0.1" },
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  return response.text();
}

async function fetchWorldBank(path) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        headers: { "User-Agent": "System Atlas data pipeline/0.1" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`World Bank request failed (${response.status}) for ${path}`);
      const payload = await response.json();
      if (!Array.isArray(payload) || !payload[0]) throw new Error(`Unexpected World Bank response for ${path}`);
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
    }
  }
  throw lastError;
}

async function mapWithConcurrency(items, concurrency, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = rows.shift() ?? [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

async function archiveText(directory, filename, text) {
  await mkdir(directory, { recursive: true });
  await writeFile(new URL(filename, directory), text);
}

const generatedAt = new Date().toISOString();
const archiveDate = generatedAt.slice(0, 10);

const countryPayload = await fetchWorldBank("/country?format=json&per_page=400");
const sourceCountries = countryPayload[1].filter(
  (country) => country.region?.value && country.region.value !== "Aggregates" && country.iso2Code,
);

const countries = new Map(
  sourceCountries.map((country) => [
    country.id,
    {
      iso3: country.id,
      iso2: country.iso2Code,
      name: country.name,
      regionCode: country.region.id,
      regionName: country.region.value,
      incomeCode: country.incomeLevel?.id ?? "",
      incomeName: country.incomeLevel?.value ?? "",
      capitalCity: country.capitalCity || undefined,
      longitude: asNumber(country.longitude),
      latitude: asNumber(country.latitude),
      entityType: "world-bank-economy",
      rosterBasis: "Included in the World Bank country/economy API roster; this roster includes sovereign states, territories, and other reporting economies.",
      latest: {},
      history: {},
    },
  ]),
);
countries.set("TWN", {
  iso3: "TWN", iso2: "TW", name: "Taiwan", regionCode: "EAS", regionName: "East Asia & Pacific",
  incomeCode: "HIC", incomeName: "High income", capitalCity: "Taipei",
  longitude: 121.5654, latitude: 25.033, latest: {}, history: {},
  entityType: "additional-economy", rosterBasis: "Added for cross-source coverage because it is absent from the World Bank roster used by this atlas.",
});
countries.set("VAT", {
  iso3: "VAT", iso2: "VA", name: "Vatican City", regionCode: "ECS", regionName: "Europe & Central Asia",
  incomeCode: "", incomeName: "", capitalCity: "Vatican City",
  longitude: 12.4534, latitude: 41.9029, latest: {}, history: {},
  entityType: "observer-state", rosterBasis: "Included as a United Nations non-member observer state; connected sources currently provide limited or no observations.",
});
if (countries.has("PSE")) {
  Object.assign(countries.get("PSE"), {
    entityType: "observer-state",
    rosterBasis: "Included as a United Nations non-member observer state and World Bank reporting economy.",
  });
}

let upstreamLastUpdated = "";
const rawByIndicator = {};

const worldBankPayloads = await mapWithConcurrency(worldBankIndicators, 6, async (indicator) => {
  const path = `/country/all/indicator/${indicator.sourceIndicatorId}?format=json&per_page=20000&mrnev=8`;
  const payload = await fetchWorldBank(path);
  return { indicator, payload };
});

for (const { indicator, payload } of worldBankPayloads) {
  upstreamLastUpdated = payload[0].lastupdated || upstreamLastUpdated;
  rawByIndicator[indicator.sourceIndicatorId] = payload;

  for (const row of payload[1] ?? []) {
    const country = countries.get(row.countryiso3code);
    const value = asNumber(row.value);
    if (!country || value === null) continue;
    const observation = {
      period: row.date,
      value,
      status: defaultObservationStatus(indicator),
      // Link to the exact official API series used by the importer. The public
      // data.worldbank.org pages are not a dependable provenance target: they
      // reject ISO-3 location parameters and intermittently render a branded
      // error page with HTTP 200. The API accepts the country's ISO-2 code and
      // remains usable for WDI and the revised WGI series alike.
      sourceUrl: `${API_BASE}/country/${country.iso2}/indicator/${indicator.sourceIndicatorId}?format=json&date=${START_YEAR}:${END_YEAR}&per_page=1000`,
    };
    (country.history[indicator.id] ??= []).push(observation);
  }
}

// WGI publishes standard errors as companion series. They are optional so a
// transient companion-series failure never suppresses the point estimates.
const wgiStandardErrors = await mapWithConcurrency(
  worldBankIndicators.filter((indicator) => indicator.sourceId === "world-bank-wgi"),
  2,
  async (indicator) => {
    const sourceIndicatorId = indicator.sourceIndicatorId.replace(/_SC$/, "_SE");
    try {
      const payload = await fetchWorldBank(`/country/all/indicator/${sourceIndicatorId}?format=json&per_page=20000&mrnev=8`);
      rawByIndicator[sourceIndicatorId] = payload;
      return { indicator, payload };
    } catch (error) {
      console.warn(`WGI uncertainty unavailable for ${indicator.id}: ${error.message}`);
      return null;
    }
  },
);
for (const item of wgiStandardErrors.filter(Boolean)) {
  for (const row of item.payload[1] ?? []) {
    const standardError = asNumber(row.value);
    const history = countries.get(row.countryiso3code)?.history[item.indicator.id];
    const observation = history?.find((candidate) => candidate.period === row.date);
    if (observation && standardError !== null) observation.uncertainty = { standardError, level: "published standard error" };
  }
}

const undpDownloadsPage = await fetchText(UNDP_DOWNLOADS_URL);
const undpMatch = undpDownloadsPage.match(/https?:\/\/[^"'<>\s]+HDR\d+_Composite_indices_complete_time_series\.csv/i);
if (!undpMatch) throw new Error("UNDP current composite-indices CSV link was not found");
const undpCsvUrl = undpMatch[0];
const undpCsv = await fetchText(undpCsvUrl);
const undpRows = parseCsv(undpCsv);
for (const row of undpRows) {
  const country = countries.get(row.iso3);
  if (!country) continue;
  for (const indicator of undpIndicators) {
    for (let year = START_YEAR; year <= END_YEAR; year += 1) {
      const value = asNumber(row[`${indicator.sourceIndicatorId}_${year}`]);
      if (value === null) continue;
      (country.history[indicator.id] ??= []).push({
        period: String(year),
        value,
        status: "modelled",
        sourceUrl: undpCsvUrl,
      });
    }
  }
}

const ideaPage = await fetchText(IDEA_INDEX_URL);
const ideaMatch = ideaPage.match(/download-proxy\?url=([^"'&\s]*gsod_indices_v\d+\.csv)/i);
if (!ideaMatch) throw new Error("International IDEA current CSV link was not found");
const ideaCsvUrl = decodeURIComponent(ideaMatch[1]);
const ideaCsv = await fetchText(ideaCsvUrl);
const ideaRows = parseCsv(ideaCsv);
for (const row of ideaRows) {
  const country = countries.get(row.iso3c === "UVK" || row.iso3c === "KOS" ? "XKX" : row.iso3c);
  const year = Number(row.year);
  if (!country || year < START_YEAR || year > END_YEAR) continue;
  for (const indicator of ideaIndicators) {
    const value = asNumber(row[indicator.sourceIndicatorId]);
    if (value === null || value < 0 || value > 1) continue;
    const baseName = indicator.sourceIndicatorId.replace(/_est$/, "");
    const lower = asNumber(row[`${baseName}_l`]);
    const upper = asNumber(row[`${baseName}_u`]);
    (country.history[indicator.id] ??= []).push({
      period: String(year), value, status: "modelled", sourceUrl: IDEA_INDEX_URL,
      ...(lower !== null && upper !== null ? { uncertainty: { lower, upper, level: "published model interval" } } : {}),
    });
  }
}

const regimeCsv = await fetchText(REGIME_CSV_URL);
const regimeRows = parseCsv(regimeCsv);
const regimeIndicator = regimeIndicators[0];
for (const row of regimeRows) {
  const iso3 = row.Code === "UVK" || row.Code === "KOS" ? "XKX" : row.Code;
  const country = countries.get(iso3);
  const year = Number(row.Year);
  const value = asNumber(row["Political regime"]);
  if (!regimeIndicator || !country || year < START_YEAR || year > END_YEAR || value === null) continue;
  (country.history[regimeIndicator.id] ??= []).push({
    period: String(year), value, status: "modelled", sourceUrl: "https://ourworldindata.org/grapher/political-regime?tab=chart",
  });
}

const imfPayloads = await mapWithConcurrency(imfIndicators, 4, async (indicator) => {
  const response = await fetch(`${IMF_API_BASE_URL}/${indicator.sourceIndicatorId}`, {
    headers: { "User-Agent": "System Atlas data pipeline/0.1" }, signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`IMF download failed (${response.status}) for ${indicator.sourceIndicatorId}`);
  return { indicator, payload: await response.json() };
});
for (const { indicator, payload } of imfPayloads) {
  const series = payload.values?.[indicator.sourceIndicatorId] ?? {};
  for (const [rawIso3, periods] of Object.entries(series)) {
    const iso3 = rawIso3 === "UVK" || rawIso3 === "KOS" ? "XKX" : rawIso3;
    const country = countries.get(iso3);
    if (!country) continue;
    for (const [period, rawValue] of Object.entries(periods)) {
      const value = asNumber(rawValue);
      const year = Number(period);
      if (value === null || year < START_YEAR || year > END_YEAR) continue;
      (country.history[indicator.id] ??= []).push({
        period, value, status: "unknown",
        sourceUrl: `https://www.imf.org/external/datamapper/${indicator.sourceIndicatorId}%40GDD`,
      });
    }
  }
}

for (const country of countries.values()) {
  for (const [indicatorId, history] of Object.entries(country.history)) {
    history.sort((a, b) => a.period.localeCompare(b.period));
    country.latest[indicatorId] = history.at(-1);
  }
}

const sourceLatestYears = new Map();
for (const indicator of indicatorCatalog) {
  const years = [...countries.values()]
    .flatMap((country) => country.history[indicator.id] ?? [])
    .map((observation) => Number(observation.period))
    .filter(Number.isFinite);
  const latest = years.length ? Math.max(...years) : undefined;
  const previous = sourceLatestYears.get(indicator.sourceId);
  if (latest !== undefined && (previous === undefined || latest > previous)) sourceLatestYears.set(indicator.sourceId, latest);
}
const runtimeSources = sourceCatalog.map((source) => ({
  ...source,
  lastCheckedAt: generatedAt,
  releaseLastUpdated: source.id === "world-bank-api" || source.id.startsWith("world-bank-")
    ? upstreamLastUpdated || String(sourceLatestYears.get(source.id) ?? "")
    : String(sourceLatestYears.get(source.id) ?? ""),
  releaseId: source.id === "undp-hdro" ? undpCsvUrl.match(/HDR\d+/i)?.[0]
    : source.id === "international-idea-gsod" ? ideaCsvUrl.match(/v\d+/i)?.[0]
      : undefined,
  status: "current",
}));
const runtimeIndicators = indicatorCatalog.map((indicator) => ({
  ...indicator,
  defaultObservationStatus: defaultObservationStatus(indicator),
}));
const sortedCountries = [...countries.values()].sort((a, b) => a.name.localeCompare(b.name));
const contentChecksum = createHash("sha256").update(JSON.stringify({ indicators: runtimeIndicators, countries: sortedCountries })).digest("hex");
const snapshot = {
  schemaVersion: 2,
  generatedAt,
  contentChecksum,
  source: {
    id: deliverySource.id,
    name: deliverySource.name,
    homepageUrl: deliverySource.homepageUrl,
    lastUpdated: upstreamLastUpdated,
    licenseName: deliverySource.licenseName,
    licenseUrl: deliverySource.licenseUrl,
  },
  sources: runtimeSources,
  indicators: [...runtimeIndicators].sort((a, b) => a.displayOrder - b.displayOrder),
  countries: sortedCountries,
};

const serialized = `${JSON.stringify(snapshot)}\n`;
const digest = createHash("sha256").update(serialized).digest("hex");
await mkdir(new URL("../public/data/", import.meta.url), { recursive: true });
await rm(publicProfilesDirectory, { recursive: true, force: true });
await mkdir(publicProfilesDirectory, { recursive: true });
await mkdir(rawDirectory, { recursive: true });
await mkdir(undpRawDirectory, { recursive: true });
await mkdir(ideaRawDirectory, { recursive: true });
await mkdir(regimeRawDirectory, { recursive: true });
await mkdir(imfRawDirectory, { recursive: true });
await writeFile(outputPath, serialized);
const publicIndex = {
  schemaVersion: snapshot.schemaVersion,
  generatedAt,
  contentChecksum,
  source: snapshot.source,
  sources: runtimeSources,
  indicators: snapshot.indicators,
  countries: sortedCountries.map(({ history, ...summary }) => summary),
};
await writeFile(publicIndexPath, `${JSON.stringify(publicIndex)}\n`);
await Promise.all(sortedCountries.map((country) =>
  writeFile(new URL(`${country.iso3}.json`, publicProfilesDirectory), `${JSON.stringify({ country })}\n`),
));
await archiveText(undpRawDirectory, `${archiveDate}-${undpCsvUrl.match(/HDR\d+/i)?.[0] ?? "composite-indices"}.csv`, undpCsv);
await archiveText(ideaRawDirectory, `${archiveDate}-${ideaCsvUrl.match(/v\d+/i)?.[0] ?? "gsod"}.csv`, ideaCsv);
await archiveText(regimeRawDirectory, `${archiveDate}-political-regime.csv`, regimeCsv);
await archiveText(imfRawDirectory, `${archiveDate}-gdd.json`, `${JSON.stringify(Object.fromEntries(imfPayloads.map(({ indicator, payload }) => [indicator.sourceIndicatorId, payload])))}\n`);
await writeFile(
  new URL(`${generatedAt.slice(0, 10)}-${digest.slice(0, 12)}.json`, rawDirectory),
  `${JSON.stringify({ generatedAt, upstreamLastUpdated, countryPayload, rawByIndicator })}\n`,
);

console.log(
  JSON.stringify({
    output: outputPath.pathname,
    generatedAt,
    upstreamLastUpdated,
    countries: countries.size,
    indicators: indicatorCatalog.length,
    worldBankIndicators: worldBankIndicators.length,
    undpIndicators: undpIndicators.length,
    ideaIndicators: ideaIndicators.length,
    regimeIndicators: regimeIndicators.length,
    imfIndicators: imfIndicators.length,
    checksum: digest,
    contentChecksum,
    staticIndexBytes: Buffer.byteLength(JSON.stringify(publicIndex)),
  }),
);
