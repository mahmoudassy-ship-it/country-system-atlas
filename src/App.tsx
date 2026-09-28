import { ChevronDown, Database, LoaderCircle } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { BrandMark } from "./components/BrandMark";
import { CountryPanel } from "./components/CountryPanel";
import { PeerPlot } from "./components/PeerPlot";
import { SearchBox } from "./components/SearchBox";
import { SourceDrawer } from "./components/SourceDrawer";
import { TrendChart } from "./components/TrendChart";
import { loadCountryProfile, loadInitialDataset, type InitialDataset } from "./data/client";
import { DOMAIN_LABELS } from "./data/domains";
import type { CountryProfile, IndicatorDefinition } from "./data/types";

const WorldMap = lazy(() =>
  import("./components/WorldMap").then((module) => ({ default: module.WorldMap })),
);

function App() {
  const [dataset, setDataset] = useState<InitialDataset | null>(null);
  const [country, setCountry] = useState<CountryProfile | null>(null);
  const [selectedIso3, setSelectedIso3] = useState("PRT");
  const [selectedIndicatorId, setSelectedIndicatorId] = useState("wb-gdp-per-capita-ppp");
  const [activeTab, setActiveTab] = useState("Overview");
  const [analysisView, setAnalysisView] = useState<"trends" | "peers">("trends");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadingCountry, setLoadingCountry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contextRef = useRef<HTMLElement>(null);

  useEffect(() => {
    loadInitialDataset()
      .then(setDataset)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load data"));
  }, []);

  useEffect(() => {
    if (!dataset) return;
    setLoadingCountry(true);
    loadCountryProfile(selectedIso3)
      .then((profile) => {
        setCountry(profile);
        setError(null);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load country"))
      .finally(() => setLoadingCountry(false));
  }, [dataset, selectedIso3]);

  const selectedIndicator = useMemo(
    () => dataset?.indicators.find((indicator) => indicator.id === selectedIndicatorId) ?? null,
    [dataset, selectedIndicatorId],
  );
  const indicatorGroups = useMemo(
    () => Object.entries(DOMAIN_LABELS)
      .map(([domain, label]) => ({
        domain,
        label,
        indicators: (dataset?.indicators ?? []).filter((indicator) => indicator.domain === domain),
      }))
      .filter((group) => group.indicators.length > 0),
    [dataset],
  );

  const selectIndicator = (indicator: IndicatorDefinition) => {
    setSelectedIndicatorId(indicator.id);
    setDrawerOpen(true);
  };

  if (error && !dataset) {
    return (
      <main className="fatal-state">
        <Database size={32} />
        <h1>System Atlas could not load its reviewed data.</h1>
        <p>{error}</p>
        <button type="button" onClick={() => window.location.reload()}>Try again</button>
      </main>
    );
  }

  if (!dataset || !country || !selectedIndicator) {
    return (
      <main className="loading-state">
        <LoaderCircle className="spin" size={28} />
        <p>Loading the atlas and its source metadata…</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#explore" aria-label="System Atlas home">
          <BrandMark />
          <span>System Atlas</span>
        </a>
        <nav aria-label="Primary navigation">
          <a className="active" href="#explore">Explore</a>
          <button
            type="button"
            onClick={() => {
              setAnalysisView("peers");
              contextRef.current?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Compare
          </button>
          <button type="button" onClick={() => setDrawerOpen(true)}>Methodology</button>
          <button type="button" onClick={() => setDrawerOpen(true)}>Data sources</button>
        </nav>
        <SearchBox countries={dataset.countries} onSelect={setSelectedIso3} />
      </header>

      <main id="explore">
        <section className="explore-grid">
          <div className="map-pane">
            <label className="metric-select">
              <span className="sr-only">Map metric</span>
              <select
                value={selectedIndicator.id}
                onChange={(event) => setSelectedIndicatorId(event.target.value)}
              >
                {indicatorGroups.map((group) => (
                  <optgroup label={group.label} key={group.domain}>
                    {group.indicators.map((indicator) => (
                      <option value={indicator.id} key={indicator.id}>{indicator.shortName}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </label>
            <Suspense fallback={<div className="map-loading"><LoaderCircle className="spin" size={24} /> Loading map…</div>}>
              <WorldMap
                countries={dataset.countries}
                indicator={selectedIndicator}
                selectedIso3={selectedIso3}
                onSelect={setSelectedIso3}
              />
            </Suspense>
          </div>
          <div className={loadingCountry ? "panel-wrap loading" : "panel-wrap"}>
            <CountryPanel
              country={country}
              indicators={dataset.indicators}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onMetricSelect={selectIndicator}
              onSourcesOpen={() => setDrawerOpen(true)}
            />
          </div>
        </section>

        <section className="country-context" ref={contextRef}>
          <div className="context-title">
            <h2>{country.name} in context</h2>
            <div />
            <span>
              {dataset.mode === "verified-snapshot" ? "Verified source snapshot" : "Live data API"}
              {dataset.refreshStatus?.freshness ? ` · ${dataset.refreshStatus.freshness}` : ""}
              {dataset.refreshStatus?.status === "failed" ? " · latest refresh failed; serving last verified data" : ""}
              {dataset.upstreamLastUpdated ? ` · source updated ${dataset.upstreamLastUpdated}` : ""}
            </span>
          </div>
          <div className="context-tabs" role="tablist" aria-label="Country analysis view">
            <button
              id="analysis-trends-tab"
              className={analysisView === "trends" ? "active" : undefined}
              type="button"
              role="tab"
              aria-selected={analysisView === "trends"}
              aria-controls="analysis-trends-panel"
              onClick={() => setAnalysisView("trends")}
            >
              Trends over time
            </button>
            <button
              id="analysis-peers-tab"
              className={analysisView === "peers" ? "active" : undefined}
              type="button"
              role="tab"
              aria-selected={analysisView === "peers"}
              aria-controls="analysis-peers-panel"
              onClick={() => setAnalysisView("peers")}
            >
              Compare with peers
            </button>
          </div>
          <div className="context-controls">
            <label>
              <span className="sr-only">Context metric</span>
              <select
                value={selectedIndicator.id}
                onChange={(event) => setSelectedIndicatorId(event.target.value)}
              >
                {indicatorGroups.map((group) => (
                  <optgroup label={group.label} key={group.domain}>
                    {group.indicators.map((indicator) => (
                      <option value={indicator.id} key={indicator.id}>{indicator.shortName}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </label>
          </div>
          <div className="analysis-grid single">
            {analysisView === "trends" ? <article
              id="analysis-trends-panel"
              className="trend-panel"
              role="tabpanel"
              aria-labelledby="analysis-trends-tab"
            >
              <h3>{selectedIndicator.name}</h3>
              <p>{selectedIndicator.unit}</p>
              <TrendChart history={country.history[selectedIndicator.id] ?? []} indicator={selectedIndicator} />
            </article> : <article
              id="analysis-peers-panel"
              className="peer-panel"
              role="tabpanel"
              aria-labelledby="analysis-peers-tab"
            >
              <h3>{selectedIndicator.name}</h3>
              <p>{country.regionName} peers · latest available year per country</p>
              <PeerPlot countries={dataset.countries} selectedCountry={country} indicator={selectedIndicator} />
            </article>}
          </div>
        </section>
      </main>

      <SourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        country={country}
        indicator={selectedIndicator}
        sourceName={dataset.sourceName}
      />
    </div>
  );
}

export default App;
