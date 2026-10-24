import { cimacMaintenancePost } from "@/features/business-actions/cimac-maintenance-http";
export const POST = (request: Request) => cimacMaintenancePost(request, "execute");
