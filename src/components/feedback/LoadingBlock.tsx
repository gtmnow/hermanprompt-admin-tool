type LoadingBlockProps = {
  label?: string;
};

export function LoadingBlock({ label = "Loading dashboard data..." }: LoadingBlockProps) {
  return <div className="loading-block">{label}</div>;
}
