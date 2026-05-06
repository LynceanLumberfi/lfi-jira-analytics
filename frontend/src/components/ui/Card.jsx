import { cn } from "../../lib/cn";

export function Card({ sunken = false, className, children, ...rest }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border shadow-sm",
        sunken ? "bg-bg-sunken" : "bg-bg-elev",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...rest }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border px-5 py-4",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardBody({ pad = "default", className, children, ...rest }) {
  return (
    <div
      className={cn(
        pad === "lg" ? "p-7" : pad === "sm" ? "p-3" : "p-5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...rest }) {
  return (
    <h3
      className={cn("text-[14px] font-semibold text-ink", className)}
      {...rest}
    >
      {children}
    </h3>
  );
}

export function CardSubtitle({ className, children, ...rest }) {
  return (
    <p className={cn("text-[12.5px] text-ink-3", className)} {...rest}>
      {children}
    </p>
  );
}
