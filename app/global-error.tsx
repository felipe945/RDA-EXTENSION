"use client";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html>
      <body className="flex min-h-screen items-center justify-center bg-[#070B12] text-[#E2E8F0]">
        <div className="text-center">
          <p className="mb-2 text-lg">Something broke.</p>
          <p className="text-sm text-[#94A3B8]">It&apos;s been logged — try refreshing.</p>
        </div>
      </body>
    </html>
  );
}
