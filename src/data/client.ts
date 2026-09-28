import type {
  CountryProfile,
  CountrySummary,
  DatasetSnapshot,
  IndicatorDefinition,
} from "./types";
import coreIndicatorCatalog from "./indicator-catalog.json";
import additionalIndicatorCatalog from "./additional-indicator-catalog.json";
import expandedIndicatorCatalog from "./expanded-indicator-catalog.json";
import inclusiveIndicatorCatalog from "./inclusive-indicator-catalog.json";

export interface InitialDataset {
  countries: CountrySummary[];
  indicators: IndicatorDefinition[];
  generatedAt?: string;
  upstreamLastUpdated?: string;
  sourceName: string;
  mode: "live-api" | "verified-snapshot";
  sources?: DatasetSnapshot["sources"];
  refreshStatus?: { status?: string; completedAt?: string; freshness?: string };
}

type StaticIndex = Omit<DatasetSnapshot, "countries"> & { countries: CountrySummary[] };
let snapshotPromise: Promise<StaticIndex> | undefined;
const reviewedIndicatorCount = coreIndicatorCatalog.length + additionalIndicatorCatalog.length + expandedIndicatorCatalog.length + inclusiveIndicatorCatalog.length;
const apiOrigin = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.replace(/\/$/, "") ?? "";
const apiUrl = (path: string) => `${apiOrigin}${path}`;

const getSnapshot = () => {
  snapshotPromise ??= fetch("/data/atlas-index.json").then(async (response) => {
    if (!response.ok) throw new Error("Verified data snapshot is unavailable");
    return response.json() as Promise<StaticIndex>;
  });
  return snapshotPromise;
};

const isJsonResponse = (response: Response) =>
  response.ok && response.headers.get("content-type")?.includes("application/json");

export async function loadInitialDataset(): Promise<InitialDataset> {
  try {
    const [countriesResponse, indicatorsResponse, healthResponse] = await Promise.all([
      fetch(apiUrl("/api/countries")),
      fetch(apiUrl("/api/indicators")),
      fetch(apiUrl("/api/health")),
    ]);
    if (!isJsonResponse(countriesResponse) || !isJsonResponse(indicatorsResponse)) {
      throw new Error("Pages API is not available in this runtime");
    }
    const [{ countries }, { indicators }, health] = await Promise.all([
      countriesResponse.json() as Promise<{ countries: CountrySummary[] }>,
      indicatorsResponse.json() as Promise<{ indicators: IndicatorDefinition[] }>,
      isJsonResponse(healthResponse)
        ? (healthResponse.json() as Promise<{ generatedAt?: string; latestRun?: { completedAt?: string; status?: string }; freshness?: string }>)
        : Promise.resolve(null),
    ]);
    if (!countries.length || indicators.length < reviewedIndicatorCount) {
      throw new Error("Pages API has not published the complete reviewed dataset yet");
    }
    return {
      countries,
      indicators,
      generatedAt: health?.generatedAt ?? health?.latestRun?.completedAt,
      sourceName: "System Atlas source registry",
      mode: "live-api",
      refreshStatus: health ? { status: health.latestRun?.status, completedAt: health.latestRun?.completedAt, freshness: health.freshness } : undefined,
    };
  } catch {
    const snapshot = await getSnapshot();
    const sources = new Map(snapshot.sources.map((source) => [source.id, source]));
    return {
      countries: snapshot.countries,
      indicators: snapshot.indicators.map((indicator) => {
        const source = sources.get(indicator.sourceId);
        return {
          ...indicator,
          sourceName: source?.name,
          sourceHomepageUrl: source?.homepageUrl,
          sourceMethodologyUrl: source?.methodologyUrl,
          sourceLicenseName: source?.licenseName,
          sourceLicenseUrl: source?.licenseUrl,
        };
      }),
      generatedAt: snapshot.generatedAt,
      upstreamLastUpdated: snapshot.source.lastUpdated,
      sourceName: snapshot.source.name,
      mode: "verified-snapshot",
      sources: snapshot.sources,
    };
  }
}

export async function loadCountryProfile(iso3: string): Promise<CountryProfile> {
  try {
    const response = await fetch(apiUrl(`/api/countries/${encodeURIComponent(iso3)}`));
    if (!isJsonResponse(response)) throw new Error("Country API unavailable");
    const payload = (await response.json()) as {
      country: CountryProfile;
      indicators?: IndicatorDefinition[];
    };
    if ((payload.indicators?.length ?? 0) < reviewedIndicatorCount) {
      throw new Error("Country API has not published the complete reviewed dataset yet");
    }
    return payload.country;
  } catch {
    const response = await fetch(`/data/countries/${encodeURIComponent(iso3)}.json`);
    if (!isJsonResponse(response)) throw new Error(`No verified profile is available for ${iso3}`);
    const payload = await response.json() as { country: CountryProfile };
    return payload.country;
  }
}
