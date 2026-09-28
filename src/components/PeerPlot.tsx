import type { CountrySummary, IndicatorDefinition } from "../data/types";
import { formatMetric } from "../lib/metrics";

export function PeerPlot({
  countries,
  selectedCountry,
  indicator,
}: {
  countries: CountrySummary[];
  selectedCountry: CountrySummary;
  indicator: IndicatorDefinition;
}) {
  const selectedObservation = selectedCountry.latest[indicator.id];
  if (!selectedObservation) {
    return <div className="chart-empty">No {indicator.name.toLowerCase()} observation is available for {selectedCountry.name}; a regional comparison would be misleading.</div>;
  }
  const allPeers = countries
    .filter(
      (country) =>
        country.regionCode === selectedCountry.regionCode &&
        country.latest[indicator.id]?.value !== undefined,
    )
    .sort((a, b) => a.latest[indicator.id]!.value - b.latest[indicator.id]!.value);
  const selectedIndex = allPeers.findIndex((country) => country.iso3 === selectedCountry.iso3);
  const start = Math.max(0, Math.min(allPeers.length - 5, selectedIndex - 2));
  const peers = allPeers.slice(start, start + 5);
  const values = peers.map((country) => country.latest[indicator.id]!.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const min = rawMin < 0 && rawMax > 0 ? rawMin : Math.min(0, rawMin);
  const max = rawMin < 0 && rawMax > 0 ? rawMax : Math.max(0, rawMax);
  const spread = max - min || 1;
  const position = (value: number) => 3 + ((value - min) / spread) * 94;
  const zeroPosition = position(0);

  return (
    <div className="peer-plot" role="group" aria-label={`${indicator.name} compared with regional peers`}>
      {peers.map((country) => {
        const observation = country.latest[indicator.id]!;
        const selected = country.iso3 === selectedCountry.iso3;
        return (
          <div className={selected ? "peer-row selected" : "peer-row"} key={country.iso3}>
            <span>{country.name}</span>
            <div className="peer-line">
              {min < 0 && max > 0 && <em style={{ left: `${zeroPosition}%` }} aria-hidden="true" />}
              <i style={{ left: `${position(observation.value)}%` }} />
            </div>
            <strong>{formatMetric(observation.value, indicator)} <small>{observation.period}</small></strong>
          </div>
        );
      })}
      {!peers.length && <div className="chart-empty">No regional peer observations are available.</div>}
    </div>
  );
}
