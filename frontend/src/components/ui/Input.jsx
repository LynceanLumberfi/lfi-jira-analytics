import { cn } from "../../lib/cn";

export function Input({ mono = false, className, ...rest }) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded border border-border bg-bg-elev px-3 text-sm text-ink",
        "placeholder:text-ink-4",
        "focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft",
        "disabled:bg-bg-sunken disabled:text-ink-3 disabled:cursor-not-allowed",
        mono && "font-mono text-[13px]",
        className,
      )}
      {...rest}
    />
  );
}

export function Label({ className, children, ...rest }) {
  return (
    <label
      className={cn(
        "block text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3 mb-1.5",
        className,
      )}
      {...rest}
    >
      {children}
    </label>
  );
}
