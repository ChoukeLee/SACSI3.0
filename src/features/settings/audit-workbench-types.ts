import type { AuditLogRow } from "./audit-log-enrichment";

export interface AuditWorkbenchFilters {
  dateFrom: string;
  dateTo: string;
  action: string;
  entityType: string;
  actor: string;
  channel: string;
  identity: string;
  search: string;
}
export interface AuditWorkbenchQuery extends AuditWorkbenchFilters {
  page: number;
}
export interface AuditWorkbenchResult {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: 30;
  filters: AuditWorkbenchFilters;
  summary: { total: number; recorded: number; missingIdentity: number; maintenance: number };
  options: { actions: string[]; entityTypes: string[]; actors: { key: string; label: string }[] };
}
export interface AuditWorkbenchExport {
  rows: AuditLogRow[];
  total: number;
  filters: AuditWorkbenchFilters;
}
