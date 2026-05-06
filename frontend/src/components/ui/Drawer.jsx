import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

export function Drawer({ open, onClose, title, children, width = "w-[540px]" }) {
  const backdropRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 transition-all",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
    >
      {/* backdrop */}
      <div
        ref={backdropRef}
        className={cn(
          "absolute inset-0 bg-black/40 backdrop-blur-[1px] transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />

      {/* panel */}
      <div
        className={cn(
          "absolute right-0 top-0 flex h-full flex-col border-l border-border bg-bg-elev shadow-2xl transition-transform duration-200",
          width,
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-3 hover:bg-bg-sunken hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
