import { describe, expect, it } from "vitest";
import type { IndicatorDefinition, Observation } from "../data/types";
import { calculateChange, changeTone, formatMetric, isoFlag, metricRange, normalizedValue } from "./metrics";

const indicator: IndicatorDefinition = {
  id: "test",
  sourceId: "source",
  sourceIndicatorId: "TEST",
  slug: "test",
  name: "Test",
  shortName: "Test",
  domain: "test",
  unit: "%",
  format: "percent",
  preferredDirection: "lower",
  decimals: 1,
  definition: "Definition",
  interpretation: "Interpretation",
  whyItMatters: "Why",
  caveat: "Caveat",
  isHeadline: true,
  displayOrder: 1,
};

const observations: Observation[] = [
  { period: "2015", value: 20, status: "reported" },
  { period: "2025", value: 15, status: "reported" },
];

describe("metric helpers", () => {
  it("formats values using indicator metadata", () => {
    expect(formatMetric(12.34, indicator)).toBe("12.3%");
    expect(formatMetric(17_265, {
      ...indicator,
      unit: "constant 2021 international $",
      format: "currency",
      decimals: 0,
    })).toBe("Intl$ 17,265");
    expect(formatMetric(365_000_000_000, {
      ...indicator,
      unit: "current US$",
      format: "currency",
      decimals: 0,
    })).toBe("US$ 365B");
  });

  it("calculates a comparable period change", () => {
    expect(calculateChange(observations, indicator)).toEqual({ value: -5, display: "percentage-point", baselinePeriod: "2015" });
  });

  it("interprets direction without treating contextual measures as good or bad", () => {
    const change = calculateChange(observations, indicator);
    expect(changeTone(change, "lower")).toBe("favorable");
    expect(changeTone(change, "higher")).toBe("adverse");
    expect(changeTone(change, "contextual")).toBe("neutral");
  });

  it("normalizes logarithmic map values", () => {
    const range = metricRange([100, 1_000, 10_000], true);
    expect(normalizedValue(100, range)).toBe(0);
    expect(normalizedValue(10_000, range)).toBe(1);
  });

  it("converts ISO2 codes to flag emoji", () => {
    expect(isoFlag("pt")).toBe("🇵🇹");
  });
});
