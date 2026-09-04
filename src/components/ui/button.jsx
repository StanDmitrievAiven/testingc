import { cn } from "../../lib/utils.js";

export function Button({ className, variant = "primary", ...props }) {
  const styles = {
    primary: "bg-ink text-paper hover:bg-ink/90",
    secondary: "border border-ink/15 bg-white hover:bg-ink/5",
    ghost: "hover:bg-ink/5",
    danger: "bg-red-700 text-white hover:bg-red-800",
  };
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust disabled:opacity-50",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}
