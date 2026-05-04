import { CircleHelp } from "lucide-react";

type CardHelpTooltipProps = {
  text: string;
};

export function CardHelpTooltip({ text }: CardHelpTooltipProps) {
  return (
    <div className="card-help">
      <button
        type="button"
        className="card-help__trigger"
        aria-label={text}
      >
        <CircleHelp size={16} />
      </button>
      <div className="card-help__bubble" role="tooltip">
        {text}
      </div>
    </div>
  );
}
