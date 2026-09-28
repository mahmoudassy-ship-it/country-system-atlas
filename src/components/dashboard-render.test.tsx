// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import snapshot from "../../data/system-atlas-snapshot.json";
import type { DatasetSnapshot } from "../data/types";
import { CountryPanel } from "./CountryPanel";
import { WorldMap } from "./WorldMap";

const dataset = snapshot as unknown as DatasetSnapshot;
const egypt = dataset.countries.find((country) => country.iso3 === "EGY")!;
const regime = dataset.indicators.find((indicator) => indicator.id === "vdem-regime-type")!;

describe("expanded dashboard rendering", () => {
  it("shows the full catalogue and the democracy and public-finance sections", () => {
    const onTabChange = vi.fn();
    const { rerender } = render(
      <CountryPanel
        country={egypt}
        indicators={dataset.indicators}
        activeTab="Overview"
        onTabChange={onTabChange}
        onMetricSelect={vi.fn()}
        onSourcesOpen={vi.fn()}
      />,
    );
    expect(screen.getByText(/of 87 indicators/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Democracy" }));
    expect(onTabChange).toHaveBeenCalledWith("Democracy");

    rerender(
      <CountryPanel
        country={egypt}
        indicators={dataset.indicators}
        activeTab="Democracy"
        onTabChange={onTabChange}
        onMetricSelect={vi.fn()}
        onSourcesOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("Representation")).toBeTruthy();
    expect(screen.getByText("Civil liberties")).toBeTruthy();
    expect(screen.getByText("Gender equality · democracy")).toBeTruthy();

    rerender(
      <CountryPanel
        country={egypt}
        indicators={dataset.indicators}
        activeTab="PublicFinance"
        onTabChange={onTabChange}
        onMetricSelect={vi.fn()}
        onSourcesOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("Government debt")).toBeTruthy();
    expect(screen.getByText("Military spending · GDP")).toBeTruthy();
    expect(screen.getByText("Education share · budget")).toBeTruthy();
  });

  it("renders regime categories with a discrete color and readable label", () => {
    render(
      <WorldMap
        countries={dataset.countries}
        indicator={regime}
        selectedIso3="EGY"
        onSelect={vi.fn()}
      />,
    );
    const egyptPath = screen.getByRole("button", { name: /Egypt, Arab Rep\.: Electoral autocracy, \d{4}/ });
    expect(egyptPath.getAttribute("fill")).toBe("#d48324");
    expect(screen.getByText("Closed autocracy")).toBeTruthy();
    expect(screen.getAllByText("Electoral autocracy").length).toBeGreaterThan(0);
  });
});
