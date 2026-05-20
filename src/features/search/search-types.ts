export type SearchResultType =
  | "customer" | "unit" | "daily_booking" | "lease" | "sale"
  | "receivable" | "payment" | "document";

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string;
  description: string;
  href: string;
  priority: number; // 3=exact match, 2=recent, 1=historical, 0=fallback
  sourceId: string;
  unitLabel: string;
  customerName: string;
  date: string;
  amount: number;
  status: string;
}

export interface SearchResults {
  query: string;
  results: SearchResult[];
  totalCount: number;
}
