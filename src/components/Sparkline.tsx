import type { Observation } from "../data/types";

export function Sparkline({ history, tone }: { history: Observation[]; tone: string }) {
  const data = history.slice(-10);
  const values = data.map((observation) => observation.value);
  if (values.length < 2) return <span className="sparkline-empty">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const periods = data.map((observation) => Number(observation.period));
  const firstPeriod = Math.min(...periods);
  const periodRange = Math.max(...periods) - firstPeriod || 1;
  const points = data
    .map((observation) => `${((Number(observation.period) - firstPeriod) / periodRange) * 76},${28 - ((observation.value - min) / range) * 22}`)
    .join(" ");
  return (
    <svg className={`sparkline ${tone}`} viewBox="0 0 76 32" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
