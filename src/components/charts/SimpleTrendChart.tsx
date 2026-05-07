import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CardHelpTooltip } from "../cards/CardHelpTooltip";

type Point = {
  bucket: string;
  value: number | null;
};

type SimpleTrendChartProps = {
  title: string;
  subtitle?: string;
  data: Point[];
  color?: string;
  emptyMessage?: string;
  tooltipText?: string;
  plotNullAsZero?: boolean;
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

export function SimpleTrendChart({
  title,
  subtitle,
  data,
  color = "#00AEEF",
  emptyMessage = "Not enough scored sessions in this period to show a trend yet.",
  tooltipText,
  plotNullAsZero = false,
}: SimpleTrendChartProps) {
  const normalizedData = data.map((point) => ({
    ...point,
    value: plotNullAsZero && point.value === null ? 0 : point.value,
  }));
  const populatedPointCount = normalizedData.filter((point) => point.value !== null).length;

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
            <LineChart data={normalizedData}>
              <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" />
              <XAxis dataKey="bucket" tick={{ fill: "#64748B", fontSize: 12 }} tickFormatter={formatAxisBucket} />
              <YAxis tick={{ fill: "#64748B", fontSize: 12 }} />
              <Tooltip labelFormatter={(label) => formatTooltipBucket(String(label))} />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={3} dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
