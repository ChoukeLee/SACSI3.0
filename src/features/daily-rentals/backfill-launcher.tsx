"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { ComponentProps } from "react";
import type { BookingPanel } from "./booking-panel";
import { Button } from "@/components/ui/button";

const BackfillPanel = dynamic(() =>
  import("./booking-panel").then((module) => module.BookingPanel),
);
type Props = Pick<ComponentProps<typeof BookingPanel>, "units" | "customers" | "locale"> & {
  disabled?: boolean;
};

/** Rendered above both calendar layouts; writes still require the admin server action. */
export function BackfillLauncher({ units, customers, locale, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={disabled || !units.length}>
        {locale === "zh" ? "补录已结束住宿" : "Saisir un séjour terminé"}
      </Button>
      {open && (
        <BackfillPanel
          booking={null}
          unitId={null}
          units={units}
          customers={customers}
          locale={locale}
          payments={[]}
          cleaningTasks={[]}
          backfillMode
          onClose={() => setOpen(false)}
          onChanged={() => setOpen(false)}
        />
      )}
    </>
  );
}
