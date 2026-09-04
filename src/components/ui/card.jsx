import { cn } from "../../lib/utils.js";

export function Card({ className, ...props }) {
  return <div className={cn("rounded-xl border border-ink/10 bg-white", className)} {...props} />;
}
