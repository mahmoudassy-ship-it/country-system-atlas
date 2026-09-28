import { describe, expect, it } from "vitest";
import coreIndicatorCatalog from "./indicator-catalog.json";
import additionalIndicatorCatalog from "./additional-indicator-catalog.json";
import expandedIndicatorCatalog from "./expanded-indicator-catalog.json";
import sourceCatalog from "./source-catalog.json";
import snapshot from "../../data/system-atlas-snapshot.json";
import type { DatasetSnapshot } from "./types";

const reviewedSnapshot = snapshot as unknown as DatasetSnapshot;
const indicatorCatalog = [...coreIndicatorCatalog, ...additionalIndicatorCatalog, ...expandedIndicatorCatalog];

const governanceIds = [
  "wgi-voice-accountability",
  "wgi-government-effectiveness",
  "wgi-rule-of-law",
  "wgi-control-corruption",
];

describe("reviewed source catalog", () => {
  it("uses unique identifiers and valid source references", () => {
    const sourceIds = new Set(sourceCatalog.map((source) => source.id));
    expect(sourceIds).toEqual(new Set([
      "world-bank-api", "world-bank-wdi", "world-bank-wgi", "undp-hdro",
      "international-idea-gsod", "owid-vdem", "imf-gdd",
    ]));
    expect(new Set(indicatorCatalog.map((indicator) => indicator.id)).size).toBe(indicatorCatalog.length);
    expect(new Set(indicatorCatalog.map((indicator) => indicator.slug)).size).toBe(indicatorCatalog.length);
    expect(new Set(indicatorCatalog.map((indicator) => indicator.sourceIndicatorId)).size).toBe(
      indicatorCatalog.length,
    );
    expect(indicatorCatalog.every((indicator) => sourceIds.has(indicator.sourceId))).toBe(true);
    expect(sourceCatalog.every((source) => {
      return [source.homepageUrl, source.methodologyUrl, source.licenseUrl]
        .filter((url): url is string => Boolean(url))
        .every((url) => new URL(url).protocol === "https:");
    })).toBe(true);
    expect(JSON.stringify(sourceCatalog)).not.toContain("datacatalog.worldbank.org/public-licenses");
    expect(JSON.stringify(sourceCatalog)).not.toContain("imf.org/external/terms.htm");
  });

  it("keeps an explanation and limitation with every measure", () => {
    for (const indicator of indicatorCatalog) {
      expect(indicator.definition.length).toBeGreaterThan(30);
      expect(indicator.interpretation.length).toBeGreaterThan(30);
      expect(indicator.whyItMatters.length).toBeGreaterThan(30);
      expect(indicator.caveat.length).toBeGreaterThan(30);
    }
  });

  it("uses the current revised WGI score series", () => {
    const governance = indicatorCatalog.filter((indicator) => governanceIds.includes(indicator.id));
    expect(governance.map((indicator) => indicator.sourceIndicatorId)).toEqual([
      "GOV_WGI_VA_SC",
      "GOV_WGI_GE_SC",
      "GOV_WGI_RL_SC",
      "GOV_WGI_CC_SC",
    ]);
    expect(governance.every((indicator) => indicator.sourceId === "world-bank-wgi")).toBe(true);
    expect(governance.every((indicator) => indicator.unit.includes("0–100"))).toBe(true);
  });

  it("includes the agreed employment, education, health, gender, safety, services, and climate coverage", () => {
    const domains = new Set(indicatorCatalog.map((indicator) => indicator.domain));
    for (const domain of [
      "work", "education", "health", "equality", "services", "safety", "planet",
      "democracy", "public_finance",
    ]) {
      expect(domains.has(domain)).toBe(true);
    }
    expect(indicatorCatalog.find((indicator) => indicator.id === "undp-gii")?.preferredDirection).toBe("lower");
    expect(indicatorCatalog.find((indicator) => indicator.id === "wb-youth-unemployment-female")).toBeTruthy();
    expect(indicatorCatalog.find((indicator) => indicator.id === "wb-learning-poverty")).toBeTruthy();
    expect(indicatorCatalog.find((indicator) => indicator.id === "vdem-regime-type")?.format).toBe("category");
    expect(indicatorCatalog.filter((indicator) => indicator.sourceId === "international-idea-gsod")).toHaveLength(12);
  });
});

describe("reviewed data snapshot", () => {
  it("matches the catalog and preserves country histories", () => {
    expect(reviewedSnapshot.countries).toHaveLength(219);
    expect(reviewedSnapshot.indicators).toHaveLength(indicatorCatalog.length);
    expect(reviewedSnapshot.sources.map(({ lastCheckedAt: _checked, releaseLastUpdated: _release, releaseId: _releaseId, status: _status, ...source }) => source)).toEqual(sourceCatalog);

    for (const country of reviewedSnapshot.countries) {
      for (const [indicatorId, history] of Object.entries(country.history)) {
        const periods = history.map((observation) => observation.period);
        expect(periods).toEqual([...periods].sort());
        expect(country.latest[indicatorId]).toEqual(history.at(-1));
      }
    }
  });

  it("has broad, bounded coverage for the new governance measures", () => {
    for (const indicatorId of governanceIds) {
      const observations = reviewedSnapshot.countries
        .map((country) => country.latest[indicatorId])
        .filter((observation): observation is NonNullable<typeof observation> => Boolean(observation));
      expect(observations.length).toBeGreaterThanOrEqual(200);
      expect(observations.every((observation) => observation.value >= 0 && observation.value <= 100)).toBe(true);
      expect(observations.every((observation) => {
        return /^https:\/\/api\.worldbank\.org\/v2\/country\/[A-Z]{2}\/indicator\/GOV_WGI_[A-Z]{2}_SC\?/.test(
          observation.sourceUrl ?? "",
        );
      })).toBe(true);
    }
  });

  it("has useful coverage for every published indicator", () => {
    for (const indicator of reviewedSnapshot.indicators) {
      const observations = reviewedSnapshot.countries
        .map((country) => country.latest[indicator.id])
        .filter((observation): observation is NonNullable<typeof observation> => Boolean(observation));
      const minimumCoverage = indicator.sourceId === "imf-gdd" ? 75 : 100;
      expect(observations.length, indicator.id).toBeGreaterThanOrEqual(minimumCoverage);
      expect(observations.every((observation) => Number.isFinite(observation.value)), indicator.id).toBe(true);
    }
  });

  it("keeps UNDP composite indices within their documented scales", () => {
    for (const indicatorId of ["undp-hdi", "undp-ihdi", "undp-gii", "undp-phdi"]) {
      const values = reviewedSnapshot.countries
        .map((country) => country.latest[indicatorId]?.value)
        .filter((value): value is number => typeof value === "number");
      expect(values.length, indicatorId).toBeGreaterThanOrEqual(150);
      expect(values.every((value) => value >= 0 && value <= 1), indicatorId).toBe(true);
    }
  });

  it("publishes the requested unemployment subgroup series as rates", () => {
    for (const indicatorId of [
      "wb-unemployment-total",
      "wb-unemployment-female",
      "wb-unemployment-male",
      "wb-youth-unemployment",
      "wb-youth-unemployment-female",
      "wb-youth-unemployment-male",
    ]) {
      const values = reviewedSnapshot.countries
        .map((country) => country.latest[indicatorId]?.value)
        .filter((value): value is number => typeof value === "number");
      expect(values.length, indicatorId).toBeGreaterThanOrEqual(180);
      expect(values.every((value) => value >= 0 && value <= 100), indicatorId).toBe(true);
    }
  });
});
