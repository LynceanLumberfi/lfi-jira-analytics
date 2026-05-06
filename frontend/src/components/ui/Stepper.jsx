import { Check } from "lucide-react";
import { cn } from "../../lib/cn";

export function Stepper({ steps, current = 0 }) {
  return (
    <ol className="flex items-center gap-3">
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step} className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold",
                done && "bg-ok text-white",
                active && "bg-accent text-[color:var(--accent-ink)]",
                !done && !active && "bg-bg-sunken text-ink-3",
              )}
            >
              {done ? <Check size={14} strokeWidth={3} /> : i + 1}
            </div>
            <span
              className={cn(
                "text-[12.5px] font-medium",
                active && "text-ink",
                done && "text-ink-2",
                !done && !active && "text-ink-3",
              )}
            >
              {step}
            </span>
            {i < steps.length - 1 && (
              <span
                className={cn(
                  "h-px w-8",
                  done ? "bg-ok" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
