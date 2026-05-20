import { cn } from "../../lib/cn";
import { Sparkline } from "../charts/Sparkline";

const TONE_STRIPE = {
  default: "bg-accent",
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  info: "bg-info",
};

const TONE_VALUE = {
  default: "text-ink",
  accent: "text-accent",
  ok: "text-ok",
  warn: "text-warn",
  err: "text-err",
  info: "text-info",
};

const TONE_SUB = {
  default: "text-ink-3",
  accent: "text-ink-3",
  ok: "text-ok",
  warn: "text-warn",
  err: "text-err",
  info: "text-info",
};

function TooltipBubble({ prevValue, prevSub }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden
                    -translate-x-1/2 whitespace-nowrap rounded-md border border-border
                    bg-bg-elev px-3 py-2 shadow-md group-hover:block">
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-3 mb-1">
        Prev week
      </p>
      <p className="text-[13px] font-semibold text-ink">{prevValue}</p>
      {prevSub && <p className="mt-0.5 text-[11px] text-ink-4">{prevSub}</p>}
    </div>
  );
}

export function DeltaArrow({ direction, tone, diffLabel, prevValue, prevSub }) {
  if (direction == null) {
    return (
      <span className="relative group inline-flex items-center text-[12px] font-semibold text-ink-4">
        ±0
        <TooltipBubble prevValue={prevValue} prevSub={prevSub} />
      </span>
    );
  }
  const colorClass =
    tone === "ok" ? "text-ok"
    : tone === "err" ? "text-err"
    : tone === "warn" ? "text-warn"
    : "text-ink-4";
  const isUp = direction === "up";
  return (
    <span className={cn("relative group inline-flex items-center gap-0.5 text-[12px] font-bold leading-none", colorClass)}>
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
        {isUp
          ? <path d="M6 2 L10 8 L2 8 Z" fill="currentColor" />
          : <path d="M6 10 L10 4 L2 4 Z" fill="currentColor" />}
      </svg>
      <span>{diffLabel}</span>
      <TooltipBubble prevValue={prevValue} prevSub={prevSub} />
    </span>
  );
}

export function KpiHero({
  label,
  value,
  sub,
  tone = "default",
  delta,
  spark,
  sparkTone = "accent",
}) {
  const stripe = TONE_STRIPE[tone] ?? TONE_STRIPE.default;
  const valueClass = TONE_VALUE[tone] ?? TONE_VALUE.default;
  const subClass = TONE_SUB[tone] ?? TONE_SUB.default;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-border bg-bg-elev shadow-sm",
        "transition-shadow hover:shadow-md",
      )}
    >
      <div className={cn("absolute inset-x-0 top-0 h-1", stripe)} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
              {label}
            </p>
            <div className="mt-2 flex items-baseline gap-1.5">
              <p className={cn("text-[28px] font-bold leading-tight", valueClass)}>
                {value}
              </p>
              {delta && (
                <DeltaArrow
                  direction={delta.direction}
                  tone={delta.tone}
                  diffLabel={delta.diffLabel}
                  prevValue={delta.prevValue}
                  prevSub={delta.prevSub}
                />
              )}
            </div>
            {sub && <p className={cn("mt-1 text-[12.5px]", subClass)}>{sub}</p>}
          </div>
          {spark?.length > 0 && (
            <Sparkline data={spark} tone={sparkTone} width={110} height={36} />
          )}
        </div>
      </div>
    </div>
  );
}

function defaultFmtDiff(absDiff, curr, prev) {
  if (Math.abs(curr) <= 1 && Math.abs(prev) <= 1) {
    return `${(absDiff * 100).toFixed(1)}%`;
  }
  if (
    Math.abs(curr - Math.round(curr)) < 0.001 &&
    Math.abs(prev - Math.round(prev)) < 0.001
  ) {
    return String(Math.round(absDiff));
  }
  return absDiff.toFixed(1);
}

export function computeDelta({ curr, prev, higherIsBetter = true, fmtPrev, fmtDiff, prevSub }) {
  if (curr == null || prev == null) return null;
  const diff = curr - prev;
  const prevValue = fmtPrev ?? String(prev);
  const prevSubResolved = prevSub ?? "";
  if (diff === 0) {
    return { direction: null, tone: "flat", diffLabel: "±0", prevValue, prevSub: prevSubResolved };
  }
  const direction = diff > 0 ? "up" : "down";
  const isGood = higherIsBetter ? direction === "up" : direction === "down";
  const absDiff = Math.abs(diff);
  const diffLabel = fmtDiff ? fmtDiff(absDiff) : defaultFmtDiff(absDiff, curr, prev);
  return {
    direction,
    tone: isGood ? "ok" : "err",
    diffLabel,
    prevValue,
    prevSub: prevSubResolved,
  };
}
