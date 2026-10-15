import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  CalendarWindowError,
  parseCalendarWindow,
} from "@/features/daily-rentals/calendar-window-model";
import { readCalendarWindow } from "@/features/daily-rentals/calendar-window-service";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "authenticationRequired" }, { status: 401, headers });
  if (!hasPermission(user, "daily_rentals:read"))
    return Response.json({ error: "calendarPermissionDenied" }, { status: 403, headers });
  try {
    const search = new URL(request.url).searchParams;
    if ([...search.keys()].some((key) => search.getAll(key).length !== 1))
      throw new CalendarWindowError("invalidCalendarWindow", 400);
    const query = parseCalendarWindow(Object.fromEntries(search));
    return Response.json(await readCalendarWindow(await createClient(), query, user.role), {
      headers,
    });
  } catch (error) {
    const failure = error instanceof CalendarWindowError ? error : new CalendarWindowError();
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
}
