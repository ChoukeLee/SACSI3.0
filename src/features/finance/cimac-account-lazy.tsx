"use client";

import dynamic from "next/dynamic";
import type { CimacAccountContentProps } from "./cimac-account-content";

// Keep the financial forms out of the non-financial workspace's initial bundle.
const AccountContent = dynamic(() =>
  import("./cimac-account-content").then((m) => m.CimacAccountContent),
);

export function CimacAccountLazy(props: CimacAccountContentProps) {
  return <AccountContent {...props} />;
}
