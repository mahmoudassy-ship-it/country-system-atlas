import { mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import coreIndicatorCatalog from "../src/data/indicator-catalog.json" with { type: "json" };
import additionalIndicatorCatalog from "../src/data/additional-indicator-catalog.json" with { type: "json" };
import expandedIndicatorCatalog from "../src/data/expanded-indicator-catalog.json" with { type: "json" };
import inclusiveIndicatorCatalog from "../src/data/inclusive-indicator-catalog.json" with { type: "json" };
import sourceCatalog from "../src/data/source-catalog.json" with { type: "json" };

const API_BASE = "https://api.worldbank.org/v2";
const UNDP_DOWNLOADS_URL = "https://hdr.undp.org/data-center/documentation-and-downloads";
const IDEA_INDEX_URL = "https://www.idea.int/democracytracker/gsod-indices";
const REGIME_CSV_URL = "https://ourworldindata.org/grapher/political-regime.csv?v=1&csvType=full&useColumnShortNames=false&external_link=true";
const IMF_API_BASE_URL = "https://www.imf.org/external/datamapper/api/v2";
const ILGA_GRAPHQL_URL = "https://database.ilga.org/graphql";
const UN_SDG_API_URL = "https://unstats.un.org/SDGAPI/v1/sdg/Series/Data";
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
const ilgaRawDirectory = new URL("../data/source-snapshots/ilga-world/", import.meta.url);
const unSdgRawDirectory = new URL("../data/source-snapshots/un-sdg/", import.meta.url);
const deliverySource = sourceCatalog.find((source) => source.id === "world-bank-api");
if (!deliverySource) throw new Error("World Bank API source metadata is missing");
const indicatorCatalog = [...coreIndicatorCatalog, ...additionalIndicatorCatalog, ...expandedIndicatorCatalog, ...inclusiveIndicatorCatalog];
const worldBankIndicators = indicatorCatalog.filter((indicator) => indicator.sourceId.startsWith("world-bank-"));
const undpIndicators = indicatorCatalog.filter((indicator) => indicator.sourceId === "undp-hdro");
const ideaIndicators = indicatorCatalog.filter((indicator) => indicator.sourceId === "international-idea-gsod");
const regimeIndicators = indicatorCatalog.filter((indicator) => indicator.sourceId === "owid-vdem");
const imfIndicators = indicatorCatalog.filter((indicator) => indicator.sourceId === "imf-gdd");
const ilgaIndicators = indicatorCatalog.filter((indicator) => indicator.sourceId === "ilga-world-database");
const unSdgIndicators = indicatorCatalog.filter((indicator) => indicator.sourceId === "un-sdg-api");

function defaultObservationStatus(indicator) {
  if (indicator.sourceId === "international-idea-gsod" || indicator.sourceId === "owid-vdem" || indicator.sourceId === "world-bank-wgi") return "modelled";
  if (indicator.sourceId === "undp-hdro") return "modelled";
  if (indicator.sourceId === "un-sdg-api") return "estimated";
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
    for (const baseUrl of [API_BASE, "http://api.worldbank.org/v2"]) {
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          headers: { "User-Agent": "System Atlas data pipeline/0.1" },
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`World Bank request failed (${response.status}) for ${path}`);
        const payload = await response.json();
        if (!Array.isArray(payload) || !payload[0]) throw new Error(`Unexpected World Bank response for ${path}`);
        return payload;
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "User-Agent": "System Atlas data pipeline/0.1", ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  return response.json();
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

function normalizeCountryName(value) {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const unCountryAliases = {
  "bolivia plurinational state of": "bolivia",
  "congo": "congo rep",
  "democratic republic of the congo": "congo dem rep",
  "iran islamic republic of": "iran islamic rep",
  "korea democratic people s republic of": "korea dem people s rep",
  "republic of korea": "korea rep",
  "lao people s democratic republic": "lao pdr",
  "micronesia federated states of": "micronesia fed sts",
  "republic of moldova": "moldova",
  "tanzania united republic of": "tanzania",
  "united republic of tanzania": "tanzania",
  "venezuela bolivarian republic of": "venezuela rb",
  "state of palestine": "west bank and gaza",
  "bahamas": "bahamas the",
  "gambia": "gambia the",
  "egypt": "egypt arab rep",
  "slovakia": "slovak republic",
  "yemen": "yemen rep",
  "kyrgyzstan": "kyrgyz republic",
  "united states of america": "united states",
  "united kingdom of great britain and northern ireland": "united kingdom",
  "china hong kong special administrative region": "hong kong sar china",
  "china macao special administrative region": "macao sar china",
  "netherlands kingdom of the": "netherlands",
  "somalia": "somalia fed rep",
  "saint kitts and nevis": "st kitts and nevis",
  "saint lucia": "st lucia",
  "saint vincent and the grenadines": "st vincent and the grenadines",
  "united states virgin islands": "virgin islands us"
};

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

const countriesByIso2 = new Map([...countries.values()].map((country) => [country.iso2, country]));
const countriesByNormalizedName = new Map([...countries.values()].map((country) => [normalizeCountryName(country.name), country]));
function countryFromUnName(name) {
  const normalized = normalizeCountryName(name);
  return countriesByNormalizedName.get(normalized)
    ?? countriesByNormalizedName.get(unCountryAliases[normalized]);
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

const ilgaCriminalisationQuery = `
  query GetEntriesCSSA($lang: String) {
    entriesCsssa(lang: $lang) {
      id
      legal
      entry_csssa_penalty { id name }
      motherEntry {
        jurisdiction { id name un_member a2_code }
        subjurisdiction { id name }
      }
    }
  }
`;
const ilgaProtectionQuery = `
  query GetEntriesProtection($type: String!, $lang: String, $jur_id: String) {
    entriesProtection(type: $type, lang: $lang, jur_id: $jur_id) {
      id
      motherEntry {
        entry_type_id
        jurisdiction { id name short_name un_member a2_code regions { id } }
        subjurisdiction { id name slug }
      }
      so_protection_type { id name }
      gi_protection_type { id name }
      ge_protection_type { id name }
      sc_protection_type { id name }
      so_critical_date_1
      gi_critical_date_1
      ge_critical_date_1
      sc_critical_date_1
    }
  }
`;
async function fetchIlga(query, variables) {
  const payload = await fetchJson(ILGA_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (payload.errors?.length) throw new Error(`ILGA GraphQL error: ${JSON.stringify(payload.errors)}`);
  return payload;
}

const [ilgaCriminalisation, ilgaEmployment, ilgaHateCrime] = ilgaIndicators.length
  ? await Promise.all([
      fetchIlga(ilgaCriminalisationQuery, { lang: "en" }),
      fetchIlga(ilgaProtectionQuery, { type: "A1-10", lang: "en", jur_id: null }),
      fetchIlga(ilgaProtectionQuery, { type: "A1-11", lang: "en", jur_id: null }),
    ])
  : [null, null, null];
const ilgaPeriod = generatedAt.slice(0, 4);
const ilgaSourceUrls = {
  "ilga-same-sex-acts-legal": "https://database.ilga.org/criminalisation-consensual-same-sex-sexual-acts",
  "ilga-employment-protections": "https://database.ilga.org/discrimination-employment-lgbti",
  "ilga-hate-crime-protections": "https://database.ilga.org/hate-crime-law-lgbti",
};
for (const entry of ilgaCriminalisation?.data?.entriesCsssa ?? []) {
  const jurisdiction = entry.motherEntry?.jurisdiction;
  const country = countriesByIso2.get(jurisdiction?.a2_code);
  if (!country || entry.motherEntry?.subjurisdiction || typeof entry.legal !== "boolean") continue;
  (country.history["ilga-same-sex-acts-legal"] ??= []).push({
    period: ilgaPeriod,
    value: entry.legal ? 1 : 0,
    status: "unknown",
    sourceUrl: ilgaSourceUrls["ilga-same-sex-acts-legal"],
  });
}
for (const [indicatorId, payload] of [
  ["ilga-employment-protections", ilgaEmployment],
  ["ilga-hate-crime-protections", ilgaHateCrime],
]) {
  for (const entry of payload?.data?.entriesProtection ?? []) {
    const jurisdiction = entry.motherEntry?.jurisdiction;
    const country = countriesByIso2.get(jurisdiction?.a2_code);
    if (!country || entry.motherEntry?.subjurisdiction) continue;
    const protectedGrounds = [
      entry.so_protection_type,
      entry.gi_protection_type,
      entry.ge_protection_type,
      entry.sc_protection_type,
    ].filter((protection) => protection?.name === "Yes").length;
    (country.history[indicatorId] ??= []).push({
      period: ilgaPeriod,
      value: protectedGrounds,
      status: "unknown",
      sourceUrl: ilgaSourceUrls[indicatorId],
    });
  }
}

const unSdgPayloads = await mapWithConcurrency(unSdgIndicators, 2, async (indicator) => {
  const url = `${UN_SDG_API_URL}?seriesCode=${encodeURIComponent(indicator.sourceIndicatorId)}&pageSize=5000`;
  return { indicator, url, payload: await fetchJson(url) };
});
function unObservationStatus(attributes) {
  if (attributes?.Nature === "M") return "modelled";
  if (attributes?.Nature === "E" || attributes?.Nature === "CA" || attributes?.["Observation Status"] === "E") return "estimated";
  return "unknown";
}
for (const { indicator, url, payload } of unSdgPayloads) {
  for (const row of payload.data ?? []) {
    const country = countryFromUnName(row.geoAreaName);
    const year = Number(row.timePeriodStart);
    const value = asNumber(row.value);
    const dimensions = row.dimensions ?? {};
    if (!country || year < START_YEAR || year > END_YEAR || value === null) continue;
    if (dimensions["Reporting Type"] && dimensions["Reporting Type"] !== "G") continue;
    if (indicator.sourceIndicatorId === "SI_COV_DISAB" && dimensions.Sex !== "BOTHSEX") continue;
    if (dimensions["Migratory status"] && dimensions["Migratory status"] !== "_T") continue;
    (country.history[indicator.id] ??= []).push({
      period: String(year),
      value,
      status: unObservationStatus(row.attributes),
      sourceUrl: url,
    });
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
await mkdir(ilgaRawDirectory, { recursive: true });
await mkdir(unSdgRawDirectory, { recursive: true });
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
await archiveText(ilgaRawDirectory, `${archiveDate}-legal-frameworks.json`, `${JSON.stringify({ criminalisation: ilgaCriminalisation, employment: ilgaEmployment, hateCrime: ilgaHateCrime })}\n`);
await archiveText(unSdgRawDirectory, `${archiveDate}-selected-series.json`, `${JSON.stringify(Object.fromEntries(unSdgPayloads.map(({ indicator, payload }) => [indicator.sourceIndicatorId, payload])))}\n`);
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
    ilgaIndicators: ilgaIndicators.length,
    unSdgIndicators: unSdgIndicators.length,
    checksum: digest,
    contentChecksum,
    staticIndexBytes: Buffer.byteLength(JSON.stringify(publicIndex)),
  }),
);
