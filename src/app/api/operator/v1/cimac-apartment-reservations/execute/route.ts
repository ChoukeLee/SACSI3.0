import { cimacApartmentReservationHttp } from "@/features/business-actions/cimac-apartment-reservation-http";
export const POST = (request: Request) => cimacApartmentReservationHttp(request, "execute");
