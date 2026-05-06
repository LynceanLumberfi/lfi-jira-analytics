import { cn } from "../../lib/cn";

export function JiraLogo({ size = 28, className }) {
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded font-semibold",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: "var(--jira)",
        color: "white",
        fontSize: Math.max(11, size * 0.42),
      }}
      aria-label="Jira"
    >
      J
    </div>
  );
}

export function LumberLogo({ size = 28, className }) {
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded font-semibold",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: "var(--ink)",
        color: "var(--bg-elev)",
        fontSize: Math.max(11, size * 0.42),
      }}
      aria-label="Lumber"
    >
      L
    </div>
  );
}

export function ConnectorMark({ size = 28, className, letter = "?", color = "var(--ink-3)" }) {
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded border border-border bg-bg-elev font-semibold",
        className,
      )}
      style={{
        width: size,
        height: size,
        color,
        fontSize: Math.max(11, size * 0.42),
      }}
    >
      {letter}
    </div>
  );
}
