"use client";

import type { ReactElement, ReactNode } from "react";
import { ResponsiveContainer, Tooltip } from "recharts";

export function ChartContainer({ children }: { children: ReactNode }) {
  return (
    <div className="chart-container" data-chart="usage-activity">
      <ResponsiveContainer width="100%" height="100%">
        {children as ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

export function ChartTooltip({
  formatter,
  labelFormatter,
}: {
  formatter: (value: number) => string;
  labelFormatter?: (label: string) => string;
}) {
  return (
    <Tooltip
      cursor={{ stroke: "var(--border-strong)", strokeDasharray: "4 4" }}
      content={({ active, payload, label }) => {
        if (!active || !payload?.length) return null;
        return (
          <div className="chart-tooltip">
            <p>{labelFormatter
              ? labelFormatter(String(label))
              : new Date(`${String(label)}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })}</p>
            <strong>{formatter(Number(payload[0]?.value ?? 0))}</strong>
          </div>
        );
      }}
    />
  );
}
