"use client";

import { cn } from "@/lib/utils";
import styles from "./record-detail-tabs.module.css";

export function RecordDetailTabs({
  id,
  label,
  items,
  value,
  onChange,
  className,
}: {
  id: string;
  label: string;
  items: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn(styles.tabs, className)} role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          id={`${id}-tab-${item.value}`}
          aria-selected={value === item.value}
          aria-controls={`${id}-panel-${item.value}`}
          tabIndex={value === item.value ? 0 : -1}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => {
            let target: number;
            if (event.key === "ArrowRight") target = (index + 1) % items.length;
            else if (event.key === "ArrowLeft") target = (index + items.length - 1) % items.length;
            else if (event.key === "Home") target = 0;
            else if (event.key === "End") target = items.length - 1;
            else return;
            event.preventDefault();
            onChange(items[target].value);
            event.currentTarget.parentElement
              ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
              [target]?.focus();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
