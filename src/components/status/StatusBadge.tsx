import { titleCase } from "../../lib/format";

type StatusBadgeProps = {
  value: string;
  tone?: "default" | "warning";
};

function normalizeClassName(value: string) {
  return value.toLowerCase().replace(/\s+/g, "_");
}

export function StatusBadge({ value, tone = "default" }: StatusBadgeProps) {
  const toneClass = tone === "warning" ? " status-badge--warning" : "";
  return (
    <span className={`status-badge status-badge--${normalizeClassName(value)}${toneClass}`}>
      {titleCase(value)}
    </span>
  );
}
