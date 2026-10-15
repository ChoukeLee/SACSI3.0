import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  CalendarWindowError,
  parseCalendarWindow,
} from "@/features/daily-rentals/calendar-window-model";
import { readCalendarWindow } from "@/features/daily-rentals/calendar-window-service";
import { createRequestTiming } from "@/lib/performance";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  const timing = createRequestTiming();
  const started = performance.now();
  const respond = (value: unknown, status = 200) => {
    const serialization = performance.now();
    const response = Response.json(value, { status, headers });
    timing.record("response", performance.now() - serialization);
    timing.record("total", performance.now() - started);
    return timing.response(response);
  };
  try {
    const user = await timing.measure("authorization", () => getCurrentUser());
    if (!user) return respond({ error: "authenticationRequired" }, 401);
    if (!hasPermission(user, "daily_rentals:read"))
      return respond({ error: "calendarPermissionDenied" }, 403);
    const search = new URL(request.url).searchParams;
    if ([...search.keys()].some((key) => search.getAll(key).length !== 1))
      throw new CalendarWindowError("invalidCalendarWindow", 400);
    const query = parseCalendarWindow(Object.fromEntries(search));
    return respond(
      await timing.measure("database", async () =>
        readCalendarWindow(await createClient(), query, user.role),
      ),
    );
  } catch (error) {
    const failure =
      error instanceof CalendarWindowError
        ? error
        : new CalendarWindowError("calendarWindowUnavailable", 500);
    return respond({ error: failure.message }, failure.status);
  }
}
