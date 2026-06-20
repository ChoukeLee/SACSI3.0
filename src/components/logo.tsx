"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoVariant = "full" | "full-horizontal" | "icon" | "icon-mono" | "brand";

interface LogoProps {
  variant?: LogoVariant;
  size?: number;
  className?: string;
  /** Override brand text (defaults to "SACSI" for full, "科建地产" for brand) */
  label?: string;
}

/**
 * SACSI brand logo — official company mark.
 *
 * Variants:
 * - full:           Colored icon + red SACSI text (login, hero areas)
 * - full-horizontal: Colored icon + SACSI text in horizontal pill (header)
 * - icon:           Colored icon only (light bg cards, favicon)
 * - icon-mono:      White icon on primary pill (sidebar, dark bg)
 * - brand:          Icon + 科建地产 text (branded header)
 */
export function Logo({ variant = "full", size = 32, className, label }: LogoProps) {
  // Full logo — centered column layout, for login pages
  if (variant === "full") {
    return (
      <div className={cn("inline-flex flex-col items-center gap-2", className)}>
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
          className="font-extrabold italic tracking-tight text-[#E60012]"
          style={{ fontSize: size * 0.56 }}
        >
          {label ?? "SACSI"}
        </span>
      </div>
    );
  }

  // Full-horizontal — icon + text in a row, for compact headers
  if (variant === "full-horizontal") {
    const textSize = size * 0.55;
    return (
      <div className={cn("inline-flex items-center gap-2", className)}>
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
          className="font-extrabold italic tracking-tight whitespace-nowrap text-[#E60012]"
          style={{ fontSize: textSize }}
        >
          {label ?? "SACSI"}
        </span>
      </div>
    );
  }

  // Brand — icon + 科建地产 text (for header and branded surfaces)
  if (variant === "brand") {
    const iconSize = size;
    const nameSize = size * 0.5;
    const subSize = size * 0.3;
    return (
      <div className={cn("inline-flex items-center gap-2.5", className)}>
        <div className="relative shrink-0" style={{ width: iconSize, height: iconSize }}>
          <Image
            src="/logo.png"
            alt="SACSI"
            width={iconSize * 2}
            height={iconSize * 2}
            className="object-contain"
            style={{ width: iconSize, height: iconSize }}
            priority
          />
        </div>
        <div className="flex flex-col leading-none">
          <span
            className="font-semibold whitespace-nowrap text-foreground"
            style={{ fontSize: nameSize }}
          >
            科建地产
          </span>
          <span
            className="font-medium whitespace-nowrap text-muted-foreground"
            style={{ fontSize: subSize }}
          >
            SACSI
          </span>
        </div>
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
        "inline-flex shrink-0 items-center justify-center rounded-lg bg-primary shadow-sm ring-1 ring-black/5",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span
        className="relative flex items-center justify-center"
        style={{ width: size * 0.65, height: size * 0.65 }}
      >
        <Image
          src="/favicon.png"
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
