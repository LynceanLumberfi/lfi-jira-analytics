import { NavLink } from "react-router-dom";
import { cn } from "../../lib/cn";

export function TabStrip({ tabs, className }) {
  // tabs = [{ to, label, count?, end? }]
  return (
    <div
      className={cn(
        "flex items-end gap-1 overflow-x-auto border-b border-border",
        className,
      )}
    >
      {tabs.map(({ to, label, count, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              "relative -mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-[13px] font-medium transition-colors",
              isActive
                ? "border-accent text-ink"
                : "border-transparent text-ink-3 hover:text-ink-2 hover:border-border-strong",
            )
          }
        >
          {label}
          {count != null && (
            <span className="rounded-full bg-bg-sunken px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-3">
              {count}
            </span>
          )}
        </NavLink>
      ))}
    </div>
  );
}
