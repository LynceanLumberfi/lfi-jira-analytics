import { cn } from "../../lib/cn";

const variantClass = {
  default:
    "bg-bg-elev text-ink border border-border hover:bg-bg-sunken hover:border-border-strong",
  primary:
    "bg-ink text-bg-elev border border-ink hover:bg-ink-2 hover:border-ink-2",
  accent:
    "bg-accent text-[color:var(--accent-ink)] border border-accent hover:bg-accent-hover hover:border-accent-hover",
  ghost: "bg-transparent text-ink hover:bg-bg-sunken border border-transparent",
  danger:
    "bg-transparent text-err border border-err/30 hover:bg-err-soft",
};

const sizeClass = {
  sm: "h-7 text-[12.5px] px-2.5",
  default: "h-9 text-sm px-3.5",
  lg: "h-11 text-[15px] px-4",
};

export function Button({
  variant = "default",
  size = "default",
  className,
  disabled,
  children,
  ...rest
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
