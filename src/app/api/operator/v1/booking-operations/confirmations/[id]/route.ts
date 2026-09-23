import { confirmBookingOperation } from "@/features/business-actions/operator-booking-operation-http";
export async function POST(request: Request, {params}: {params: Promise<{id:string}>}) {
  return confirmBookingOperation(request, (await params).id);
}
