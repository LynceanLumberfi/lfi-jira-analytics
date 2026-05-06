import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

export function Modal({ open, onClose, children, className }) {
  const backdropRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div
        className={cn(
          "relative w-full max-w-md rounded-xl border border-border bg-bg-elev shadow-2xl",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ title, onClose }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-5 py-4">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      <button
        onClick={onClose}
        className="rounded p-1 text-ink-3 hover:bg-bg-sunken hover:text-ink"
      >
        <X size={16} />
      </button>
    </div>
  );
}

export function ModalBody({ children, className }) {
  return (
    <div className={cn("px-5 py-4", className)}>{children}</div>
  );
}

export function ModalFooter({ children }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
      {children}
    </div>
  );
}
