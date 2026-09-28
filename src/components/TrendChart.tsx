import type { IndicatorDefinition, Observation } from "../data/types";
import { formatMetric } from "../lib/metrics";

export function TrendChart({
  history,
  indicator,
}: {
  history: Observation[];
  indicator: IndicatorDefinition;
}) {
  const data = history.slice(-11);
  if (data.length < 2) return <div className="chart-empty">Not enough comparable history is available.</div>;
  const width = 680;
  const height = 220;
  const padding = { top: 18, right: 28, bottom: 34, left: 54 };
  const values = data.map((point) => point.value);
  const isCategory = indicator.format === "category";
  const min = isCategory ? 0 : Math.min(...values);
  const max = isCategory ? 3 : Math.max(...values);
  const spread = max - min || 1;
  const periods = data.map((point) => Number(point.period));
  const minPeriod = Math.min(...periods);
  const maxPeriod = Math.max(...periods);
  const periodSpread = maxPeriod - minPeriod || 1;
  const x = (period: string) => padding.left + ((Number(period) - minPeriod) / periodSpread) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + (1 - (value - min) / spread) * (height - padding.top - padding.bottom);
  const points = data.map((point) => `${x(point.period)},${y(point.value)}`).join(" ");
  const ticks = isCategory ? [3, 2, 1, 0] : [max, min + spread / 2, min];

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${indicator.name} trend over time`}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={padding.left} x2={width - padding.right} y1={y(tick)} y2={y(tick)} className="grid-line" />
            <text x={padding.left - 10} y={y(tick) + 4} textAnchor="end">{formatMetric(tick, indicator)}</text>
          </g>
        ))}
        <polyline points={points} fill="none" className="trend-line" />
        {data.map((point, index) => (
          <circle key={point.period} cx={x(point.period)} cy={y(point.value)} r={index === data.length - 1 ? 5 : 3} tabIndex={0}>
            <title>{point.period}: {formatMetric(point.value, indicator)} · {point.status}{point.uncertainty?.lower !== undefined && point.uncertainty?.upper !== undefined ? ` · published interval ${formatMetric(point.uncertainty.lower, indicator)} to ${formatMetric(point.uncertainty.upper, indicator)}` : ""}</title>
          </circle>
        ))}
        {data.map((point, index) =>
          index === 0 || index === data.length - 1 || index % 2 === 0 ? (
            <text key={point.period} x={x(point.period)} y={height - 10} textAnchor="middle">{point.period}</text>
          ) : null,
        )}
      </svg>
      <strong className="chart-latest">{formatMetric(data.at(-1)!.value, indicator)}</strong>
      <span className="sr-only">{data.map((point) => `${point.period}: ${formatMetric(point.value, indicator)}`).join("; ")}</span>
    </div>
  );
}
