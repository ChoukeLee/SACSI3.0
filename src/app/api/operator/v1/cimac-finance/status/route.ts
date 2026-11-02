import { cimacFinanceStatus } from "@/features/business-actions/cimac-finance-http";
export const GET = (request: Request) => cimacFinanceStatus(request);
