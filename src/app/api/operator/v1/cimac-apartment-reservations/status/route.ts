import { cimacApartmentReservationHttp } from "@/features/business-actions/cimac-apartment-reservation-http";
export const GET = (request: Request) => cimacApartmentReservationHttp(request, "status");
