import { bookingOperationPost } from "@/features/business-actions/operator-booking-operation-http";
export const POST = (request: Request) => bookingOperationPost(request, "drafts");
