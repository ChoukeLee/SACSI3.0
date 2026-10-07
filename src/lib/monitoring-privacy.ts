import type { ErrorEvent } from "@sentry/nextjs";

/** Preserve stack locations and safe correlation tags, not submitted business data. */
export function redactMonitoringEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  delete event.extra;
  delete event.contexts;
  delete event.message;
  if ("logentry" in event) delete event.logentry;
  if (event.tags)
    event.tags = Object.fromEntries(
      Object.entries(event.tags).filter(([name]) =>
        ["operation", "request_id", "error_code"].includes(name),
      ),
    );
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
    delete event.request.env;
    if (event.request.url) {
      try {
        const url = new URL(event.request.url);
        url.search = "";
        url.hash = "";
        event.request.url = url.toString();
      } catch {
        delete event.request.url;
      }
    }
  }
  for (const exception of event.exception?.values ?? []) {
    exception.value = "Details omitted; use operation/request_id tags for investigation";
    for (const frame of exception.stacktrace?.frames ?? []) delete frame.vars;
  }
  if (event.breadcrumbs)
    event.breadcrumbs = event.breadcrumbs.map((item) => ({
      category: item.category,
      type: item.type,
      level: item.level,
      timestamp: item.timestamp,
    }));
  return event;
}
