import * as Sentry from "@sentry/nextjs";

// Browser-side Sentry init. Replaces the old sentry.client.config.ts convention
// (required as of @sentry/nextjs v9+). Reads the public DSN so it can ship in the
// client bundle.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === "production",
});

// Instruments App Router client-side navigations for tracing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
