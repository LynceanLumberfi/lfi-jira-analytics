import { cn } from "../../lib/cn";

function hashHue(name) {
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

function initials(name) {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function Avatar({ name = "", size = 28, className }) {
  const hue = hashHue(name);
  return (
    <div
      className={cn(
        "inline-flex select-none items-center justify-center rounded-full font-semibold",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: `oklch(0.85 0.05 ${hue})`,
        color: `oklch(0.32 0.08 ${hue})`,
        fontSize: Math.max(10, size * 0.4),
      }}
    >
      {initials(name)}
    </div>
  );
}
