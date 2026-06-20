"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoVariant = "full" | "icon" | "icon-mono";

interface LogoProps {
  /** full = icon + SACSI text (login, hero). icon = icon only. icon-mono = white icon for dark bg. */
  variant?: LogoVariant;
  /** Height in px. icon variants are square. */
  size?: number;
  className?: string;
}

/**
 * SACSI brand logo component.
 *
 * Variants:
 * - full:   Full-color logo (icon + red SACSI text). Use on white/light backgrounds.
 * - icon:   Full-color icon only (no text). Use on white/light cards.
 * - icon-mono: White monochrome icon. Use on dark/primary backgrounds (sidebar pill).
 */
export function Logo({ variant = "full", size = 32, className }: LogoProps) {
  // Full logo: horizontal layout, uses the original PNG
  if (variant === "full") {
    return (
      <div className={cn("inline-flex items-center gap-3", className)} style={{ height: size }}>
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <Image
            src="/logo.png"
            alt="SACSI"
            width={size * 2}
            height={size * 2}
            className="object-contain"
            style={{ width: size, height: size }}
            priority
          />
        </div>
        <span
          className="text-lg font-extrabold italic tracking-tight text-[#E60012]"
          style={{ fontSize: size * 0.56 }}
        >
          SACSI
        </span>
      </div>
    );
  }

  // Icon only — full color, for light backgrounds
  if (variant === "icon") {
    return (
      <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
        <Image
          src="/logo.png"
          alt="SACSI"
          width={size * 2}
          height={size * 2}
          className="object-contain"
          style={{ width: size, height: size }}
        />
      </div>
    );
  }

  // Icon only — monochrome white, for dark/primary backgrounds
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg bg-primary text-[10px] font-bold tracking-wider text-primary-foreground shadow-sm ring-1 ring-black/5",
        className,
      )}
      style={{ width: size, height: size, minWidth: size > 48 ? "3.5rem" : undefined }}
    >
      {/* CSS-filtered logo — converts colored logo to white on primary bg */}
      <span
        className="relative flex items-center justify-center"
        style={{ width: size * 0.65, height: size * 0.65 }}
      >
        <Image
          src="/logo.png"
          alt="SACSI"
          width={size}
          height={size}
          className="object-contain brightness-0 invert"
          style={{ width: size * 0.65, height: size * 0.65 }}
        />
      </span>
    </span>
  );
}
