"use client";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

// Next 16: any client component reading useSearchParams must sit under a
// <Suspense> boundary or `next build` fails prerendering this route.
function LoginForm() {
  const params = useSearchParams();
  const error = params.get("error");
  // Where to land after sign-in. Relative paths only (rejects absolute URLs)
  // so this can't become an open redirect. The extension auth handoff
  // (/api/extension/auth/start) round-trips through here with its own path.
  const rawCallback = params.get("callbackUrl");
  const callbackUrl = rawCallback?.startsWith("/") && !rawCallback.startsWith("//") ? rawCallback : "/";

  return (
    <div className="w-full max-w-sm rounded-xl border border-[#1A2235] bg-[#0F1420] p-8 text-center">
      <div className="mx-auto mb-4 h-8 w-8 rounded-md" style={{ background: "#FF3A69" }} />
      <h1 className="mb-2 text-xl font-semibold text-[#E2E8F0]">Unified Sales Ops</h1>
      <p className="mb-6 text-sm text-[#94A3B8]">Sign in with your FanBasis Google account.</p>
      {error === "AccessDenied" && (
        <p className="mb-4 rounded-lg bg-[#2A1420] px-3 py-2 text-xs text-[#FF3A69]">
          This account hasn&apos;t been invited yet. Ask an admin to send you an invite first.
        </p>
      )}
      {error && error !== "AccessDenied" && (
        <p className="mb-4 rounded-lg bg-[#2A1420] px-3 py-2 text-xs text-[#FF3A69]">
          Sign-in failed. Please try again.
        </p>
      )}
      <button
        onClick={() => signIn("google", { callbackUrl })}
        className="w-full rounded-lg bg-[#FF3A69] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
      >
        Sign in with Google
      </button>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="w-full max-w-sm rounded-xl border border-[#1A2235] bg-[#0F1420] p-8 text-center">
      <div className="mx-auto mb-4 h-8 w-8 rounded-md" style={{ background: "#FF3A69" }} />
      <h1 className="mb-2 text-xl font-semibold text-[#E2E8F0]">Unified Sales Ops</h1>
      <p className="text-sm text-[#94A3B8]">Loading…</p>
    </div>
  );
}

export default function LoginPage() {
  // fixed inset-0 covers the root layout chrome (Nav hides itself on /login).
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#070B12]">
      <Suspense fallback={<LoginFallback />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
