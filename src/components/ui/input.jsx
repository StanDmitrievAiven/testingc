import { cn } from "../../lib/utils.js";

export function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        "min-h-11 w-full rounded-md border border-ink/15 bg-white px-3 text-sm outline-none focus:border-rust focus:ring-2 focus:ring-rust/20",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-rust focus:ring-2 focus:ring-rust/20",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }) {
  return <label className={cn("mb-1 block text-sm font-medium text-ink/80", className)} {...props} />;
}
