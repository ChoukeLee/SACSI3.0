"use client";

import { UnitList } from "@/features/units/unit-list";

export function UnitLazyView(props: React.ComponentProps<typeof UnitList>) {
  return <UnitList {...props} />;
}
