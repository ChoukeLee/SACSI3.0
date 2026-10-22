import { executeOperatorDirect } from "@/features/business-actions/operator-direct-execution";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return executeOperatorDirect(request, "booking_operation");
}
