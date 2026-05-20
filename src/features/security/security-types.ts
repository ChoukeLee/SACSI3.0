export interface SecurityCheckItem {
  id: string;
  label: string;
  detail: string;
  status: "pass" | "warn" | "fail";
}
