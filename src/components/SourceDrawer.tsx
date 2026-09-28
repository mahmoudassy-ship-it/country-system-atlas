import { ExternalLink, X } from "lucide-react";
import type { CountryProfile, IndicatorDefinition } from "../data/types";
import { formatMetric } from "../lib/metrics";

interface SourceDrawerProps {
  open: boolean;
  onClose: () => void;
  country: CountryProfile;
  indicator: IndicatorDefinition;
  sourceName: string;
}

export function SourceDrawer({ open, onClose, country, indicator, sourceName }: SourceDrawerProps) {
  const observation = country.latest[indicator.id];
  if (!open) return null;
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="source-drawer"
        aria-modal="true"
        role="dialog"
        aria-labelledby="source-drawer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="drawer-close" type="button" onClick={onClose} aria-label="Close source details">
          <X size={20} />
        </button>
        <p className="drawer-context">{country.name}</p>
        <h2 id="source-drawer-title">{indicator.name}</h2>
        {observation && (
          <div className="drawer-value">
            <div>
              <strong>{formatMetric(observation.value, indicator)}</strong>
              <small>{indicator.unit}</small>
            </div>
            <span>{observation.period} · {observation.status}</span>
          </div>
        )}
        {observation?.uncertainty && (
          <p className="drawer-uncertainty">
            Published uncertainty: {observation.uncertainty.lower !== undefined && observation.uncertainty.upper !== undefined
              ? `${formatMetric(observation.uncertainty.lower, indicator)}–${formatMetric(observation.uncertainty.upper, indicator)}`
              : `standard error ${observation.uncertainty.standardError}`}
            {observation.uncertainty.level ? ` (${observation.uncertainty.level})` : ""}
          </p>
        )}
        <section>
          <h3>What it measures</h3>
          <p>{indicator.definition}</p>
        </section>
        <section>
          <h3>How to read it</h3>
          <p>{indicator.interpretation}</p>
        </section>
        <section>
          <h3>Why it matters</h3>
          <p>{indicator.whyItMatters}</p>
        </section>
        <section className="drawer-caveat">
          <h3>Important limitation</h3>
          <p>{indicator.caveat}</p>
        </section>
        <section>
          <h3>Source</h3>
          <p>{indicator.sourceName ?? sourceName}</p>
          {observation?.sourceUrl && (
            <a href={observation.sourceUrl} target="_blank" rel="noreferrer">
              Open the source data <ExternalLink size={15} />
            </a>
          )}
          {indicator.sourceMethodologyUrl && (
            <a href={indicator.sourceMethodologyUrl} target="_blank" rel="noreferrer">
              Read the methodology <ExternalLink size={15} />
            </a>
          )}
          {indicator.sourceLicenseName && (
            <p className="drawer-license">
              License: {indicator.sourceLicenseUrl ? (
                <a href={indicator.sourceLicenseUrl} target="_blank" rel="noreferrer">
                  {indicator.sourceLicenseName} <ExternalLink size={13} />
                </a>
              ) : indicator.sourceLicenseName}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
