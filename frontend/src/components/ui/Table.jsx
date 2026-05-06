import { cn } from "../../lib/cn";

export function Table({ className, children }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-bg-elev",
        className,
      )}
    >
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }) {
  return (
    <thead className="bg-bg-sunken text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
      {children}
    </thead>
  );
}

export function TBody({ children }) {
  return <tbody>{children}</tbody>;
}

export function TR({ className, ...rest }) {
  return (
    <tr
      className={cn(
        "border-b border-border last:border-b-0 hover:bg-bg-sunken/50",
        className,
      )}
      {...rest}
    />
  );
}

export function TH({ className, ...rest }) {
  return (
    <th
      className={cn("px-4 py-2 text-left font-semibold", className)}
      {...rest}
    />
  );
}

export function TD({ className, ...rest }) {
  return (
    <td
      className={cn("px-4 py-3 align-middle text-ink-2", className)}
      {...rest}
    />
  );
}
