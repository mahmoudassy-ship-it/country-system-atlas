import type { Direction, IndicatorDefinition, Observation } from "../data/types";

export function formatMetric(value: number, indicator: IndicatorDefinition): string {
  if (indicator.format === "category") {
    return indicator.categoryLabels?.[String(Math.round(value))] ?? `Category ${value}`;
  }
  const options: Intl.NumberFormatOptions = {
    maximumFractionDigits: indicator.decimals,
    minimumFractionDigits: indicator.decimals,
  };
  if (indicator.format === "currency") {
    const formatted = new Intl.NumberFormat("en", {
      notation: value >= 100_000 ? "compact" : "standard",
      maximumFractionDigits: 0,
    }).format(value);
    const currency = indicator.unit.toLowerCase().includes("international $")
      ? "Intl$"
      : indicator.unit.toLowerCase().includes("us$")
        ? "US$"
        : "$";
    return `${currency} ${formatted}`;
  }
  const formatted = new Intl.NumberFormat("en", options).format(value);
  if (indicator.format === "percent") return `${formatted}%`;
  if (indicator.format === "years") return `${formatted} years`;
  return formatted;
}

export interface MetricChange {
  value: number;
  display: "relative-percent" | "percentage-point" | "absolute";
  baselinePeriod: string;
}

function inferredChangeDisplay(indicator: IndicatorDefinition): MetricChange["display"] | "none" {
  if (indicator.changeDisplay) return indicator.changeDisplay;
  if (indicator.format === "category") return "none";
  if (indicator.format === "percent") return "percentage-point";
  if (indicator.format === "years" || indicator.format === "rate") return "absolute";
  if (indicator.unit.toLowerCase().includes("index") || indicator.unit.toLowerCase().includes("score")) return "absolute";
  return "relative-percent";
}

export function calculateChange(history: Observation[], indicator: IndicatorDefinition): MetricChange | null {
  const values = history.filter((observation) => Number.isFinite(observation.value)).slice(-11);
  if (values.length < 2) return null;
  const first = values[0].value;
  const last = values.at(-1)!.value;
  const display = inferredChangeDisplay(indicator);
  if (display === "none" || (display === "relative-percent" && first === 0)) return null;
  return {
    value: display === "relative-percent" ? ((last - first) / Math.abs(first)) * 100 : last - first,
    display,
    baselinePeriod: values[0].period,
  };
}

export function changeTone(change: MetricChange | null, direction: Direction) {
  if (change === null || direction === "neutral" || direction === "contextual") return "neutral";
  const improving = direction === "higher" ? change.value > 0 : change.value < 0;
  if (Math.abs(change.value) < 0.05) return "neutral";
  return improving ? "favorable" : "adverse";
}

export function changeLabel(change: MetricChange | null) {
  if (change === null) return "No trend";
  const rounded = Math.abs(change.value) >= 10 ? change.value.toFixed(0) : change.value.toFixed(1);
  const suffix = change.display === "relative-percent" ? "%" : change.display === "percentage-point" ? " pp" : "";
  return `${change.value > 0 ? "+" : ""}${rounded}${suffix}`;
}

export const observationAge = (period: string, referenceYear = new Date().getUTCFullYear()) =>
  /^\d{4}$/.test(period) ? referenceYear - Number(period) : null;

export function isoFlag(iso2: string) {
  return iso2
    .toUpperCase()
    .replace(/./g, (character) => String.fromCodePoint(127397 + character.charCodeAt(0)));
}

export function metricRange(values: number[], logarithmic = false) {
  const transformed = values.map((value) => (logarithmic ? Math.log1p(Math.max(0, value)) : value));
  const minimum = Math.min(...transformed);
  const maximum = Math.max(...transformed);
  return { minimum, maximum, logarithmic };
}

export function normalizedValue(value: number, range: ReturnType<typeof metricRange>) {
  const transformed = range.logarithmic ? Math.log1p(Math.max(0, value)) : value;
  if (range.maximum === range.minimum) return 0.5;
  return (transformed - range.minimum) / (range.maximum - range.minimum);
}
