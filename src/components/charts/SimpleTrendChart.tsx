import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = {
  bucket: string;
  value: number;
};

type SimpleTrendChartProps = {
  title: string;
  subtitle?: string;
  data: Point[];
  color?: string;
};

export function SimpleTrendChart({
  title,
  subtitle,
  data,
  color = "#00AEEF",
}: SimpleTrendChartProps) {
  return (
    <div className="panel">
      <div className="split-header">
        <div>
          <h3 className="panel-title">{title}</h3>
          {subtitle ? <div className="muted">{subtitle}</div> : null}
        </div>
      </div>
      <div className="chart-shell">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" />
            <XAxis dataKey="bucket" tick={{ fill: "#64748B", fontSize: 12 }} />
            <YAxis tick={{ fill: "#64748B", fontSize: 12 }} />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
