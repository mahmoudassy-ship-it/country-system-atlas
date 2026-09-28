import { ChevronRight, Clock3, FileText, Info, TrendingDown, TrendingUp } from "lucide-react";
import type { CountryProfile, IndicatorDefinition } from "../data/types";
import { PROFILE_SECTIONS } from "../data/domains";
import { calculateChange, changeLabel, changeTone, formatMetric, isoFlag } from "../lib/metrics";
import { observationAge } from "../lib/metrics";
import { Sparkline } from "./Sparkline";

interface CountryPanelProps {
  country: CountryProfile;
  indicators: IndicatorDefinition[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  onMetricSelect: (indicator: IndicatorDefinition) => void;
  onSourcesOpen: () => void;
}

const OVERVIEW_INDICATOR_IDS = [
  "wb-gdp-per-capita-ppp",
  "wb-unemployment-total",
  "wb-primary-completion",
  "wb-life-expectancy",
  "undp-gii",
  "wb-gini",
  "wgi-government-effectiveness",
  "wgi-control-corruption",
  "wb-safe-water",
  "wb-homicide-rate",
  "wb-ghg-emissions-per-capita",
  "vdem-regime-type",
  "idea-representation",
  "imf-general-government-debt",
  "wb-military-expenditure-gdp",
];

export function CountryPanel({
  country,
  indicators,
  activeTab,
  onTabChange,
  onMetricSelect,
  onSourcesOpen,
}: CountryPanelProps) {
  const availableIndicators = indicators.filter((indicator) => country.latest[indicator.id]);
  const completeness = Math.round(
    (availableIndicators.length / Math.max(1, indicators.length)) * 100,
  );
  const olderIndicators = availableIndicators.filter((indicator) => (observationAge(country.latest[indicator.id]!.period) ?? 0) > 10).length;
  const section = PROFILE_SECTIONS.find((candidate) => candidate.id === activeTab) ?? PROFILE_SECTIONS[0];
  const visible = indicators
    .filter((indicator) => (activeTab === "Overview"
      ? OVERVIEW_INDICATOR_IDS.includes(indicator.id)
      : (section.domains as readonly string[]).includes(indicator.domain)))
    .filter((indicator) => country.latest[indicator.id])
    .sort((a, b) => activeTab === "Overview"
      ? OVERVIEW_INDICATOR_IDS.indexOf(a.id) - OVERVIEW_INDICATOR_IDS.indexOf(b.id)
      : a.displayOrder - b.displayOrder);
  const latestYear = visible
    .map((indicator) => country.latest[indicator.id]?.period)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <aside className="country-panel" aria-label={`${country.name} profile`}>
      <div className="country-heading">
        <div className="country-identity">
          <span className="country-flag" role="img" aria-label={`${country.name} flag`}>
            {isoFlag(country.iso2)}
          </span>
          <div>
            <h1>{country.name}</h1>
            <p>A country system profile</p>
          </div>
        </div>
        <div
          className="completeness"
          title={`Share of the full ${indicators.length}-indicator catalogue with a published value for ${country.name}. Years vary by source.`}
        >
          <span>Profile coverage <Info size={13} aria-hidden="true" /></span>
          <div><i style={{ width: `${completeness}%` }} /></div>
          <strong>{completeness}%</strong>
          <small>{availableIndicators.length} of {indicators.length} indicators{olderIndicators ? ` · ${olderIndicators} older than 10 years` : ""}</small>
        </div>
      </div>

      <div className="profile-tabs" role="tablist" aria-label="Profile dimension">
        {PROFILE_SECTIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "active" : undefined}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="metric-list">
        {visible.length ? (
          visible.map((indicator) => {
            const observation = country.latest[indicator.id]!;
            const history = country.history[indicator.id] ?? [];
            const change = calculateChange(history, indicator);
            const tone = changeTone(change, indicator.preferredDirection);
            return (
              <button
                key={indicator.id}
                type="button"
                className="metric-row"
                onClick={() => onMetricSelect(indicator)}
                aria-label={`Open details for ${indicator.name}`}
              >
                <span className="metric-name">{indicator.shortName}</span>
                <strong>{formatMetric(observation.value, indicator)}</strong>
                <span className="metric-year">{observation.period}</span>
                <Sparkline history={history} tone={tone} />
                <span className={`metric-change ${tone}`}>
                  {change !== null && (change.value > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />)}
                  <b>{indicator.format === "category" ? "Classification" : changeLabel(change)}</b>
                  <small>{change ? `vs ${change.baselinePeriod}` : ""}</small>
                </span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            );
          })
        ) : (
          <div className="metric-empty">
            <p>No connected measures are currently available in this section.</p>
            <span>Source coverage expands without substituting unrelated indicators.</span>
          </div>
        )}
      </div>

      <div className="country-panel-footer">
        <span><Clock3 size={16} /> Latest available data: {latestYear ?? "varies"}</span>
        <button type="button" onClick={onSourcesOpen}>
          <FileText size={16} /> Sources &amp; methodology <ChevronRight size={15} />
        </button>
      </div>
    </aside>
  );
}
