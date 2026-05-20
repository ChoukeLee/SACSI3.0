export interface SecurityCheckItem {
  id: string;
  label: string;
  detail: string;
  status: "pass" | "warn" | "fail";
}

export interface BackupResult {
  filename: string;
  csv: string;
  tableCount: number;
  rowCount: number;
}
