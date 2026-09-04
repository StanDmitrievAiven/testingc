import { cn } from "../../lib/utils.js";

const tones = {
  lead: "bg-stone-200 text-stone-800",
  qualified: "bg-amber-100 text-amber-900",
  proposal: "bg-orange-100 text-orange-900",
  negotiation: "bg-stone-800 text-paper",
  won: "bg-emerald-100 text-emerald-900",
  lost: "bg-stone-100 text-stone-500",
};

export function Badge({ stage, className }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
        tones[stage] || tones.lead,
        className,
      )}
    >
      {stage}
    </span>
  );
}
