type LogLevel = "debug" | "info" | "warn" | "error";

export function log(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): void {
  const isServer = typeof window === "undefined";
  const isDev = process.env.NODE_ENV === "development";

  if (level === "debug" || level === "info") {
    if (isDev) console.debug(`[${level.toUpperCase()}]`, message, context ?? "");
    return;
  }

  // warn + error always log
  console.error(`[${level.toUpperCase()}]`, message, context ?? "");

  // In prod server context, Vercel captures console output — nothing extra needed.
  // Client-side: forward errors to /api/log if it ever gets built.
  if (level === "error" && !isServer) {
    void fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level, message, context, ts: new Date().toISOString() }),
    }).catch(() => {});
  }
}
