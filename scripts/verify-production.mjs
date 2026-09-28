import { readFile } from "node:fs/promises";

const pagesOrigin = process.env.SYSTEM_ATLAS_PAGES_ORIGIN ?? "https://country-system-atlas.pages.dev";
const apiOrigin = process.env.SYSTEM_ATLAS_API_ORIGIN ?? "https://system-atlas-api.eufoniadiversity.com";
const target = { countries: 219, indicators: 71, sources: 7 };

const fetchJson = async (url) => {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error(`${url} did not return JSON`);
  return response.json();
};

const snapshot = JSON.parse(await readFile(new URL("../data/system-atlas-snapshot.json", import.meta.url), "utf8"));
const [pageResponse, health, countriesPayload, indicatorsPayload, egyptPayload] = await Promise.all([
  fetch(pagesOrigin, { headers: { Accept: "text/html" } }),
  fetchJson(`${apiOrigin}/api/health`),
  fetchJson(`${apiOrigin}/api/countries`),
  fetchJson(`${apiOrigin}/api/indicators`),
  fetchJson(`${apiOrigin}/api/countries/EGY`),
]);

const documentedIndicators = indicatorsPayload.indicators.filter((indicator) =>
  indicator.definition && indicator.interpretation && indicator.whyItMatters && indicator.caveat
).length;
const checks = {
  pagesHealthy: pageResponse.ok && (pageResponse.headers.get("content-type") ?? "").includes("text/html"),
  snapshotCountries: snapshot.countries.length === target.countries,
  snapshotIndicators: snapshot.indicators.length === target.indicators,
  serverHealthy: health.ok === true && health.ready === true && health.servingMode === "server-sqlite",
  serverFresh: health.freshness === "current" && health.latestRun?.status === "succeeded",
  serverCountries: countriesPayload.countries.length === target.countries,
  serverIndicators: indicatorsPayload.indicators.length === target.indicators,
  serverSources: health.liveCounts?.sources === target.sources,
  countsMatchHealth:
    countriesPayload.countries.length === health.liveCounts?.countries &&
    indicatorsPayload.indicators.length === health.liveCounts?.indicators,
  documentationComplete: documentedIndicators === target.indicators,
  egyptProfileComplete:
    egyptPayload.country?.iso3 === "EGY" &&
    egyptPayload.indicators?.length === target.indicators &&
    Object.keys(egyptPayload.country?.history ?? {}).length >= 69,
};
const ready = Object.values(checks).every(Boolean);

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  pagesOrigin,
  apiOrigin,
  target,
  snapshot: {
    countries: snapshot.countries.length,
    indicators: snapshot.indicators.length,
    generatedAt: snapshot.generatedAt,
  },
  server: {
    ...health.liveCounts,
    generatedAt: health.generatedAt,
    servingMode: health.servingMode,
  },
  checks,
  ready,
}, null, 2));

if (!ready) process.exitCode = 1;
