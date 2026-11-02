import { cimacFinancePost } from "@/features/business-actions/cimac-finance-http";
export const POST = (request: Request) => cimacFinancePost(request, "query");
