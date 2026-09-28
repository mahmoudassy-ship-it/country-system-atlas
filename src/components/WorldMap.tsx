import world from "@svg-maps/world";
import { Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { CountrySummary, IndicatorDefinition } from "../data/types";
import { formatMetric } from "../lib/metrics";
import { observationAge } from "../lib/metrics";

interface WorldMapProps {
  countries: CountrySummary[];
  indicator: IndicatorDefinition;
  selectedIso3: string;
  onSelect: (iso3: string) => void;
}

const CHOROPLETH_COLORS = ["#f2e8c9", "#a9d9cf", "#55b5b3", "#287c9e", "#173f70"];
const CATEGORY_COLORS = ["#8d2945", "#d48324", "#4d83c5", "#168477"];

const quantile = (sorted: number[], proportion: number) => {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * proportion) - 1));
  return sorted[index];
};

export function WorldMap({ countries, indicator, selectedIso3, onSelect }: WorldMapProps) {
  const [zoom, setZoom] = useState(1);
  const [hovered, setHovered] = useState<string | null>(null);
  const byIso2 = useMemo(
    () => new Map(countries.map((country) => [country.iso2.toLowerCase(), country])),
    [countries],
  );
  const values = useMemo(
    () =>
      countries
        .map((country) => country.latest[indicator.id]?.value)
        .filter((value): value is number => typeof value === "number")
        .sort((a, b) => a - b),
    [countries, indicator.id],
  );
  const thresholds = useMemo(
    () => [0.2, 0.4, 0.6, 0.8].map((proportion) => quantile(values, proportion)),
    [values],
  );
  const colorForValue = (value: number) => {
    if (indicator.format === "category") {
      return CATEGORY_COLORS[Math.max(0, Math.min(CATEGORY_COLORS.length - 1, Math.round(value)))];
    }
    const thresholdIndex = thresholds.findIndex((threshold) => value <= threshold);
    return CHOROPLETH_COLORS[thresholdIndex === -1 ? CHOROPLETH_COLORS.length - 1 : thresholdIndex];
  };
  const hoveredCountry = hovered ? byIso2.get(hovered) : undefined;
  const years = countries
    .map((country) => Number(country.latest[indicator.id]?.period))
    .filter(Number.isFinite);
  const yearRange = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : "unavailable";
  const directionLabels = indicator.preferredDirection === "higher"
    ? ["Lower · usually less favorable", "Higher · usually more favorable"]
    : indicator.preferredDirection === "lower"
      ? ["Lower · usually more favorable", "Higher · usually less favorable"]
      : ["Lower value", "Higher value"];

  return (
    <div className="map-stage">
      <div className="map-zoom" role="group" aria-label="Map zoom controls">
        <button type="button" onClick={() => setZoom((value) => Math.min(1.45, value + 0.15))} aria-label="Zoom in">
          <Plus size={18} />
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.max(0.85, value - 0.15))} aria-label="Zoom out">
          <Minus size={18} />
        </button>
      </div>
      <svg
        className="world-map"
        viewBox={world.viewBox}
        role="group"
        aria-label={`World map colored by ${indicator.name}`}
      >
        <g style={{ transform: `scale(${zoom})`, transformOrigin: "50% 50%" }}>
          {world.locations.map((location: { id: string; name: string; path: string }) => {
            const country = byIso2.get(location.id);
            const observation = country?.latest[indicator.id];
            const isSelected = country?.iso3 === selectedIso3;
            const fill = observation ? colorForValue(observation.value) : "#d6dde4";
            return (
              <path
                key={location.id}
                d={location.path}
                fill={fill}
                className={isSelected ? "selected" : undefined}
                tabIndex={country ? 0 : undefined}
                role={country ? "button" : "presentation"}
                aria-label={country
                  ? `${country.name}: ${observation ? `${formatMetric(observation.value, indicator)}, ${observation.period}${(observationAge(observation.period) ?? 0) > 10 ? ", older observation" : ""}` : "no data"}`
                  : undefined}
                onMouseEnter={() => setHovered(location.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(location.id)}
                onBlur={() => setHovered(null)}
                onClick={() => country && onSelect(country.iso3)}
                onKeyDown={(event) => {
                  if (country && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    onSelect(country.iso3);
                  }
                }}
              />
            );
          })}
        </g>
      </svg>
      {hoveredCountry && (
        <div className="map-tooltip" role="status">
          <strong>{hoveredCountry.name}</strong>
          <span>
            {hoveredCountry.latest[indicator.id]
              ? `${formatMetric(hoveredCountry.latest[indicator.id]!.value, indicator)} · ${hoveredCountry.latest[indicator.id]!.period}${(observationAge(hoveredCountry.latest[indicator.id]!.period) ?? 0) > 10 ? " · older" : ""}`
              : "No data"}
          </span>
        </div>
      )}
      <div className="map-legend">
        <p>{indicator.name}</p>
        {indicator.format === "category" ? (
          <>
            <span className="legend-note">Latest available classification · observation years {yearRange}</span>
            <div className="category-legend">
              {CATEGORY_COLORS.map((color, index) => (
                <span key={color}><i style={{ background: color }} />{indicator.categoryLabels?.[String(index)]}</span>
              ))}
            </div>
          </>
        ) : (
          <>
            <span className="legend-note">Country quintiles · mixed latest years {yearRange} · “older” means over 10 years old</span>
            <div className="legend-scale" aria-hidden="true">
              {CHOROPLETH_COLORS.map((color) => <i style={{ background: color }} key={color} />)}
            </div>
            <div className="legend-labels">
              <span>
                <b>{values.length ? formatMetric(values[0], indicator) : "Lower"}</b>
                <small>{directionLabels[0]}</small>
              </span>
              <span>
                <b>{values.length ? formatMetric(values.at(-1)!, indicator) : "Higher"}</b>
                <small>{directionLabels[1]}</small>
              </span>
            </div>
          </>
        )}
      </div>
      <div className="no-data-key"><span /> No data</div>
    </div>
  );
}
