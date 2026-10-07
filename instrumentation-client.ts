import * as Sentry from "@sentry/nextjs";
import { redactMonitoringEvent } from "./src/lib/monitoring-privacy";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0,
    environment: process.env.NODE_ENV,
    sendDefaultPii: false,
    beforeSend: redactMonitoringEvent,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
