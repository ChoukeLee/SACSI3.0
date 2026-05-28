import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SlidePanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  width?: "sm" | "md" | "lg";
  children: React.ReactNode;
}

const widthMap = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
} as const;

export function SlidePanel({ open, onClose, title, description, width = "sm", children }: SlidePanelProps) {
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-overlay bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          "fixed inset-y-0 right-0 z-panel w-full overflow-auto border-l border-brand-warm-200 bg-white shadow-panel",
          widthMap[width],
        )}
        role="dialog"
        aria-label={title}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-brand-warm-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div>
            <h3 className="text-base font-bold text-brand-ink-800">{title}</h3>
            {description && <p className="mt-0.5 text-xs text-brand-ink-500">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-brand-ink-400 hover:bg-brand-warm-100 hover:text-brand-ink-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </>
  );
}
