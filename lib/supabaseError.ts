type ErrorLike = {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
  description?: unknown;
  error_description?: unknown;
  msg?: unknown;
  statusText?: unknown;
  error?: unknown;
  cause?: unknown;
  data?: unknown;
  response?: unknown;
};

const toText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
};

const asErrorLike = (value: unknown): ErrorLike | null => {
  if (!value || typeof value !== "object") return null;
  return value as ErrorLike;
};

const safeJson = (value: unknown): string => {
  try {
    const s = JSON.stringify(value);
    if (!s || s === "{}" || s === "[]") return "";
    return s;
  } catch {
    return "";
  }
};

const compact = (value: string): string => {
  const t = value.trim();
  return t.length > 320 ? `${t.slice(0, 320)}...` : t;
};

const getCandidates = (err: unknown): unknown[] => {
  const queue: unknown[] = [err];
  const seen = new Set<unknown>();
  const out: unknown[] = [];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    const obj = asErrorLike(cur);
    if (!obj) continue;
    if (obj.error) queue.push(obj.error);
    if (obj.cause) queue.push(obj.cause);
    if (obj.data) queue.push(obj.data);
    const resp = asErrorLike(obj.response);
    if (resp?.data) queue.push(resp.data);
    if (resp?.error) queue.push(resp.error);
  }
  return out;
};

export function getSupabaseErrorCode(err: unknown): string | null {
  for (const c of getCandidates(err)) {
    const code = asErrorLike(c)?.code;
    if (typeof code === "string" && code.trim()) return code;
  }
  return null;
}

export function getSupabaseErrorMessage(err: unknown): string {
  for (const c of getCandidates(err)) {
    if (c instanceof Error) {
      const m = compact(c.message ?? "");
      if (m) return m;
    }
    const el = asErrorLike(c);
    if (!el) {
      const m = compact(toText(c));
      if (m && m !== "[object Object]") return m;
      continue;
    }
    const parts = [
      toText(el.message), toText(el.details), toText(el.hint),
      toText(el.error_description), toText(el.description),
      toText(el.msg), toText(el.statusText),
    ].map(compact).filter(Boolean);
    if (parts.length > 0) return parts.join(" ").trim();
    const s = compact(safeJson(c));
    if (s) return s;
  }
  return "Unknown error";
}

export function isMissingRelationError(err: unknown): boolean {
  const code = getSupabaseErrorCode(err);
  if (code === "42P01" || code === "PGRST205") return true;
  const msg = getSupabaseErrorMessage(err).toLowerCase();
  return (
    msg.includes("does not exist") ||
    msg.includes("could not find the table") ||
    msg.includes("schema cache") ||
    (msg.includes("relation") && msg.includes("does not exist"))
  );
}
