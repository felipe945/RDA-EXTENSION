"use client";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Logo from "@/components/Logo";

type InvitePreview = {
  inviter: string | null;
  role: string;
  email: string;
  expiresAt: string;
  status: "pending" | "expired" | "accepted";
};

function FBMark() {
  return (
    <div className="mx-auto mb-4 flex justify-center" aria-hidden="true">
      <Logo size={52} />
    </div>
  );
}

function roleLabel(role: string) {
  return role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Rep";
}

function expiresIn(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms < 24 * 3600 * 1000) return "Expires today";
  const days = Math.ceil(ms / (24 * 3600 * 1000));
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

function expiredOn(expiresAt: string): string {
  return new Date(expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Next 16: any client component reading useSearchParams must sit under a
// <Suspense> boundary or `next build` fails prerendering this route.
function LoginForm() {
  const params = useSearchParams();
  const error = params.get("error");
  const inviteToken = params.get("invite");
  // Where to land after sign-in. Relative paths only (rejects absolute URLs)
  // so this can't become an open redirect. The extension auth handoff
  // (/api/extension/auth/start) round-trips through here with its own path.
  const rawCallback = params.get("callbackUrl");
  const callbackUrl = rawCallback?.startsWith("/") && !rawCallback.startsWith("//") ? rawCallback : "/";

  const [effectiveToken, setEffectiveToken] = useState<string | null>(inviteToken);
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [inviteState, setInviteState] = useState<"none" | "loading" | "ok" | "invalid">(
    inviteToken ? "loading" : "none",
  );

  // The Google OAuth round-trip drops the ?invite= param (NextAuth redirects
  // errors to bare /login?error=…), so stash the token across it — otherwise
  // the wrong-account message can't name the invited email.
  useEffect(() => {
    if (inviteToken) {
      try {
        sessionStorage.setItem("fb-invite-token", inviteToken);
      } catch {}
    } else if (error) {
      try {
        const stored = sessionStorage.getItem("fb-invite-token");
        if (stored) {
          setEffectiveToken(stored);
          setInviteState("loading");
        }
      } catch {}
    }
  }, [inviteToken, error]);

  useEffect(() => {
    if (!effectiveToken) return;
    let cancelled = false;
    fetch(`/api/invites/preview?token=${encodeURIComponent(effectiveToken)}`)
      .then((res) => (res.ok ? (res.json() as Promise<InvitePreview>) : null))
      .then((data) => {
        if (cancelled) return;
        if (data) {
          setInvite(data);
          setInviteState("ok");
        } else {
          setInviteState("invalid");
        }
      })
      .catch(() => {
        if (!cancelled) setInviteState("invalid");
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveToken]);

  const pendingInvite = inviteState === "ok" && invite?.status === "pending" ? invite : null;
  const inviterFirst = invite?.inviter?.trim().split(/\s+/)[0];

  return (
    <div className="w-full max-w-sm rounded-xl border border-[#1A2235] bg-[#0F1420] p-8 text-center">
      <FBMark />

      {pendingInvite ? (
        <>
          <h1 className="mb-1 text-xl font-semibold text-[#E2E8F0]">
            {inviterFirst ? `${inviterFirst} invited you` : "You're invited"}
          </h1>
          <p className="mb-5 text-sm text-[#94A3B8]">Join FanMas</p>
          <div className="mb-5 rounded-lg border border-[#2A3554] bg-[#151B2E] px-4 py-3 text-left text-sm">
            <div className="text-[#E2E8F0]">
              For <span className="font-semibold">{pendingInvite.email}</span>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <span className="rounded-full bg-[#3B82F6]/[.12] px-2 py-0.5 text-[11px] font-semibold text-[#60A5FA]">
                {roleLabel(pendingInvite.role)}
              </span>
              <span className="rounded-full bg-[#14B8A6]/10 px-2 py-0.5 text-[11px] font-semibold text-[#14B8A6]">
                {expiresIn(pendingInvite.expiresAt)}
              </span>
            </div>
          </div>
        </>
      ) : (
        <>
          <h1 className="mb-2 text-xl font-semibold text-[#E2E8F0]">FanMas</h1>
          <p className="mb-6 text-sm text-[#94A3B8]">Sign in with your FanBasis Google account.</p>
        </>
      )}

      {inviteState === "ok" && invite?.status === "expired" && (
        <p className="mb-4 rounded-lg bg-[#d4892a]/10 px-3 py-2 text-left text-xs text-[#E0B476]">
          This invite expired {expiredOn(invite.expiresAt)}. Ask {inviterFirst ?? "an admin"} to
          resend it.
        </p>
      )}
      {inviteState === "ok" && invite?.status === "accepted" && (
        <p className="mb-4 rounded-lg bg-[#151B2E] px-3 py-2 text-left text-xs text-[#94A3B8]">
          This invite was already used — just sign in below.
        </p>
      )}
      {inviteState === "invalid" && (
        <p className="mb-4 rounded-lg bg-[#2A1420] px-3 py-2 text-left text-xs text-[#FF3A69]">
          This invite link isn&apos;t valid anymore. Ask an admin to send a new one.
        </p>
      )}

      {error === "AccessDenied" &&
        (pendingInvite ? (
          <p className="mb-4 rounded-lg bg-[#2A1420] px-3 py-2 text-left text-xs text-[#FF3A69]">
            That invite is for <span className="font-semibold">{pendingInvite.email}</span> — sign
            in with that Google account.
          </p>
        ) : (
          <p className="mb-4 rounded-lg bg-[#2A1420] px-3 py-2 text-left text-xs text-[#FF3A69]">
            This account hasn&apos;t been invited yet. Ask an admin to send you an invite first.
          </p>
        ))}
      {error && error !== "AccessDenied" && (
        <p className="mb-4 rounded-lg bg-[#2A1420] px-3 py-2 text-left text-xs text-[#FF3A69]">
          Sign-in failed. Please try again.
        </p>
      )}

      <button
        onClick={() =>
          signIn(
            "google",
            { callbackUrl },
            // Pre-select the invited Google account on Google's chooser.
            pendingInvite ? { login_hint: pendingInvite.email } : undefined,
          )
        }
        className="w-full rounded-lg bg-[#FF3A69] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#E02F5D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF3A69]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0F1420]"
      >
        {pendingInvite ? "Accept & sign in with Google" : "Sign in with Google"}
      </button>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="w-full max-w-sm rounded-xl border border-[#1A2235] bg-[#0F1420] p-8 text-center">
      <FBMark />
      <h1 className="mb-2 text-xl font-semibold text-[#E2E8F0]">FanMas</h1>
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
