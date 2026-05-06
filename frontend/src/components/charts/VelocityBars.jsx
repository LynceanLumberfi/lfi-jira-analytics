import { cn } from "../../lib/cn";

export function VelocityBars({ sprints, height = 160, className }) {
  // Expects sprints = [{ sprint_name, completed_points, planned_points, completion_pct }, ...]
  // Renders one bar per sprint with completed_points height; planned_points shown as ghost behind.
  if (!sprints?.length) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded border border-dashed border-border bg-bg-sunken text-[12.5px] text-ink-3",
          className,
        )}
        style={{ height }}
      >
        No sprint data yet — promote some issues with sprint assignments.
      </div>
    );
  }
  const maxVal = Math.max(
    1,
    ...sprints.map((s) =>
      Math.max(s.completed_points ?? 0, s.planned_points ?? 0),
    ),
  );

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        className="grid items-end gap-3"
        style={{
          gridTemplateColumns: `repeat(${sprints.length}, 1fr)`,
          height,
        }}
      >
        {sprints.map((s, i) => {
          const completed = s.completed_points ?? 0;
          const planned = s.planned_points ?? 0;
          const completedHeight = (completed / maxVal) * (height - 28);
          const plannedHeight = (planned / maxVal) * (height - 28);
          const isLast = i === sprints.length - 1;
          return (
            <div
              key={s.sprint_id ?? i}
              className="relative flex flex-col items-center justify-end"
              style={{ height: height - 8 }}
              title={`${s.sprint_name ?? "Sprint"}: ${completed}/${planned} pts`}
            >
              <span className="absolute top-0 text-[11px] font-mono text-ink-3">
                {Math.round(completed)}
              </span>
              <div
                className="absolute bottom-0 w-3/4 rounded-t bg-bg-sunken border border-border"
                style={{ height: Math.max(2, plannedHeight) }}
              />
              <div
                className={cn(
                  "absolute bottom-0 w-3/4 rounded-t transition-all",
                  isLast ? "bg-accent" : "bg-ink-4",
                )}
                style={{ height: Math.max(2, completedHeight) }}
              />
            </div>
          );
        })}
      </div>
      <div
        className="mt-2 grid gap-3 text-center text-[11px] text-ink-3"
        style={{ gridTemplateColumns: `repeat(${sprints.length}, 1fr)` }}
      >
        {sprints.map((s, i) => (
          <span key={s.sprint_id ?? i} className="truncate" title={s.sprint_name}>
            {shortSprint(s.sprint_name)}
          </span>
        ))}
      </div>
    </div>
  );
}

function shortSprint(name) {
  if (!name) return "—";
  // Strip leading project prefixes; keep last numeric/short segment.
  const trimmed = name.replace(/^.*Sprint\s*/i, "S-");
  return trimmed.length > 10 ? trimmed.slice(0, 10) + "…" : trimmed;
}
