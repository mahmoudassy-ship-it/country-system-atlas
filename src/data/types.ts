export type Direction = "higher" | "lower" | "neutral" | "contextual";
export type ObservationStatus = "reported" | "estimated" | "modelled" | "projected" | "unknown";

export interface SourceDefinition {
  id: string;
  name: string;
  homepageUrl: string;
  methodologyUrl?: string;
  licenseName: string;
  licenseUrl?: string;
  expectedCadence: string;
  lastCheckedAt?: string;
  releaseLastUpdated?: string;
  releaseId?: string;
  status?: "current" | "stale" | "unavailable";
}

export interface IndicatorDefinition {
  id: string;
  sourceId: string;
  sourceIndicatorId: string;
  slug: string;
  name: string;
  shortName: string;
  domain: string;
  unit: string;
  format: "currency" | "percent" | "years" | "rate" | "number" | "category";
  categoryLabels?: Record<string, string>;
  preferredDirection: Direction;
  decimals: number;
  definition: string;
  interpretation: string;
  whyItMatters: string;
  caveat: string;
  isHeadline: boolean;
  displayOrder: number;
  defaultObservationStatus?: ObservationStatus;
  changeDisplay?: "relative-percent" | "percentage-point" | "absolute" | "none";
  sourceName?: string;
  sourceHomepageUrl?: string;
  sourceMethodologyUrl?: string;
  sourceLicenseName?: string;
  sourceLicenseUrl?: string;
}

export interface Observation {
  period: string;
  value: number;
  status: ObservationStatus;
  sourceUrl?: string;
  uncertainty?: {
    lower?: number;
    upper?: number;
    standardError?: number;
    level?: string;
  };
}

export interface CountrySummary {
  iso3: string;
  iso2: string;
  name: string;
  regionCode: string;
  regionName: string;
  incomeCode: string;
  incomeName: string;
  capitalCity?: string;
  longitude?: number | null;
  latitude?: number | null;
  entityType?: "world-bank-economy" | "additional-economy" | "observer-state";
  rosterBasis?: string;
  latest: Record<string, Observation | undefined>;
}

export interface CountryProfile extends CountrySummary {
  history: Record<string, Observation[]>;
}

export interface DatasetSnapshot {
  schemaVersion: 2;
  generatedAt: string;
  contentChecksum?: string;
  source: {
    id: string;
    name: string;
    homepageUrl: string;
    lastUpdated?: string;
    licenseName: string;
    licenseUrl: string;
  };
  sources: SourceDefinition[];
  indicators: IndicatorDefinition[];
  countries: CountryProfile[];
}
