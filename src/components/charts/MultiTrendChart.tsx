import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CardHelpTooltip } from "../cards/CardHelpTooltip";

type MultiTrendChartPoint = {
  bucket: string;
  [key: string]: number | string | null;
};

type MultiTrendSeries = {
  key: string;
  label: string;
  color: string;
};

type MultiTrendChartProps = {
  title: string;
  subtitle?: string;
  data: MultiTrendChartPoint[];
  series: MultiTrendSeries[];
  emptyMessage?: string;
  tooltipText?: string;
};

function formatAxisBucket(bucket: string) {
  if (bucket.includes("T")) {
    return new Date(bucket).toLocaleTimeString([], { hour: "numeric" });
  }
  if (bucket.endsWith("-01") && bucket.length === 10) {
    return new Date(`${bucket}T00:00:00Z`).toLocaleDateString([], { month: "short" });
  }
  return new Date(`${bucket}T00:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatTooltipBucket(bucket: string) {
  const parsed = bucket.includes("T") ? new Date(bucket) : new Date(`${bucket}T00:00:00Z`);
  if (bucket.includes("T")) {
    return parsed.toLocaleString([], { month: "short", day: "numeric", hour: "numeric" });
  }
  if (bucket.endsWith("-01") && bucket.length === 10) {
    return parsed.toLocaleDateString([], { month: "long", year: "numeric" });
  }
  return parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatTokenValue(value: number) {
  return value.toLocaleString();
}

export function MultiTrendChart({
  title,
  subtitle,
  data,
  series,
  emptyMessage = "Not enough data is available to show this trend yet.",
  tooltipText,
}: MultiTrendChartProps) {
  const populatedPointCount = data.filter((point) =>
    series.some((item) => typeof point[item.key] === "number" && point[item.key] !== null),
  ).length;

  return (
    <div className="panel">
      {tooltipText ? <CardHelpTooltip text={tooltipText} /> : null}
      <div className="split-header">
        <div>
          <h3 className="panel-title">{title}</h3>
          {subtitle ? <div className="muted">{subtitle}</div> : null}
        </div>
      </div>
      <div className="chart-shell">
        {populatedPointCount <= 1 ? (
          <div className="empty-state chart-empty-state">{emptyMessage}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" />
              <XAxis dataKey="bucket" tick={{ fill: "#64748B", fontSize: 12 }} tickFormatter={formatAxisBucket} />
              <YAxis tick={{ fill: "#64748B", fontSize: 12 }} tickFormatter={(value) => formatTokenValue(Number(value))} />
              <Tooltip
                labelFormatter={(label) => formatTooltipBucket(String(label))}
                formatter={(value) => formatTokenValue(Number(value))}
              />
              <Legend />
              {series.map((item) => (
                <Line
                  key={item.key}
                  type="monotone"
                  dataKey={item.key}
                  name={item.label}
                  stroke={item.color}
                  strokeWidth={3}
                  dot={false}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
