"use client";

import dynamic from "next/dynamic";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
import type { Locale } from "@/lib/i18n";
import type { BuildingRow, LedgerEntryRow, ReceivableRow } from "@/types/database";

interface AttachmentRow { id: string; storage_path: string; linked_id: string; file_type: string; ocr_text: string | null; ocr_provider: string | null; metadata: Record<string, unknown> | null; paper_archive_status: string; paper_archive_location: string | null; uploaded_at: string; }

const LedgerList = dynamic(() => import("@/features/finance/ledger-list").then((mod) => ({ default: mod.LedgerList })), {
  loading: () => <OperationalPageSkeleton kind="table" rows={8} />,
  ssr: false,
});
const ReceivableList = dynamic(() => import("@/features/finance/receivable-list").then((mod) => ({ default: mod.ReceivableList })), {
  loading: () => <OperationalPageSkeleton kind="table" rows={8} />,
  ssr: false,
});
const FinanceTabs = dynamic(() => import("@/features/finance/finance-tabs").then((mod) => ({ default: mod.FinanceTabs })), {
  loading: () => <OperationalPageSkeleton kind="table" rows={8} />,
  ssr: false,
});

interface Props {
  entries: LedgerEntryRow[];
  units: { id: string; unit_no: string; building_id: string }[];
  buildingId: string | null;
  receivables: ReceivableRow[];
  customers: { id: string; name: string }[];
  buildings: BuildingRow[];
  attachments: AttachmentRow[];
  locale: Locale;
  canWrite?: boolean;
}

export function FinanceLazyView({ entries, units, buildingId, receivables, customers, buildings, attachments, locale, canWrite = true }: Props) {
  return (
    <FinanceTabs
      ledger={<LedgerList entries={entries} units={units} buildingId={buildingId} locale={locale} attachments={attachments} canWrite={canWrite} />}
      receivables={<ReceivableList receivables={receivables} units={units} customers={customers} buildings={buildings} locale={locale} />}
      locale={locale}
    />
  );
}
