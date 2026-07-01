import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
};

export default withSentryConfig(nextConfig, {
  // Suppress the noisy build-time logs unless running in CI.
  silent: !process.env.CI,
  // Upload a wider set of client source maps for readable stack traces.
  widenClientFileUpload: true,
  // org/project/authToken are only needed for source-map upload at build time;
  // set SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN in CI when you enable that.
});
