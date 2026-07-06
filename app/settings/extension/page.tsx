"use client";
// One-stop extension setup. The extension is published Unlisted on the Chrome
// Web Store, so install is one click and updates are automatic — no more
// download-zip / Load-unpacked / manual-reload. The extension self-configures
// after Google sign-in (prod dashboard URL is its default; sign-in mints the
// repToken and pulls settings via /api/extension/bootstrap).
import { useEffect, useState } from "react";
import { Puzzle, LogIn, RefreshCw, MonitorSmartphone } from "lucide-react";
import { CHROME_STORE_URL } from "@/lib/extension";

type Latest = { version: string; updatedAt: string };

function Step({
  n,
  icon,
  title,
  children,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4 rounded-xl border border-[#1A2235] bg-[#0F1420] p-5">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
        style={{ background: "linear-gradient(135deg, #FF3A69, #C22450)" }}
      >
        {n}
      </div>
      <div className="min-w-0">
        <h2 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-[#E2E8F0]">
          {icon} {title}
        </h2>
        <div className="text-[13px] leading-relaxed text-[#94A3B8]">{children}</div>
      </div>
    </div>
  );
}

export default function ExtensionSetupPage() {
  const [latest, setLatest] = useState<Latest | null>(null);

  useEffect(() => {
    fetch("/extension/latest.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.version && setLatest(d))
      .catch(() => {});
  }, []);

  const kbd =
    "rounded border border-[#2A3554] bg-[#151B2E] px-1.5 py-0.5 text-xs font-semibold text-[#CBD5E1]";

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#E2E8F0]">Chrome Extension</h1>
          <p className="mt-1 text-xs text-[#475569]">
            IG lead capture, outreach queue, and AE booking — right on Instagram.
          </p>
        </div>
        {latest && (
          <div className="text-right">
            <span className="rounded-full bg-[#3B82F6]/[.12] px-2.5 py-1 text-xs font-bold text-[#60A5FA]">
              v{latest.version}
            </span>
            <p className="mt-1 text-[11px] text-[#475569]">
              updated{" "}
              {new Date(latest.updatedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Step n={1} icon={<Puzzle size={15} className="text-[#FF3A69]" />} title="Add it to Chrome">
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-3 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #FF3A69, #C22450)" }}
          >
            <Puzzle size={15} /> Add to Chrome
          </a>
          <p>
            Opens the Chrome Web Store — click{" "}
            <span className={kbd}>Add to Chrome</span> → <span className={kbd}>Add extension</span>.
            Then pin it: puzzle-piece icon in the toolbar → 📌 next to FanMas.
          </p>
        </Step>

        <Step n={2} icon={<LogIn size={15} className="text-[#4ade80]" />} title="Sign in — that's it">
          <p>
            Go to <strong className="text-[#E2E8F0]">instagram.com</strong>, click the FanMas icon
            to open the side panel, and hit <span className={kbd}>Sign in with Google</span> using
            your <strong className="text-[#E2E8F0]">@fanbasis.com</strong> account. Everything else
            configures itself — dashboard connection, your leads, calendar booking, and the AE list.
          </p>
          <p className="mt-2 text-xs text-[#5B6B8C]">
            Heads-up: accept your dashboard invite first (sign in here once). The extension uses the
            same account.
          </p>
        </Step>

        <Step
          n={3}
          icon={<RefreshCw size={15} className="text-[#A78BFA]" />}
          title="Updates are automatic"
        >
          <p>
            Chrome keeps the extension up to date on its own — usually within a few hours of a new
            release, no action needed. You&apos;ll always be on the latest version.
          </p>
        </Step>
      </div>

      <div className="mt-4 flex gap-3 rounded-xl border border-[#1A2235] bg-[#0B0F18] p-4">
        <MonitorSmartphone size={16} className="mt-0.5 shrink-0 text-[#64748B]" />
        <p className="text-xs leading-relaxed text-[#64748B]">
          Installed an earlier <em>unpacked</em> copy? Remove it at{" "}
          <span className={kbd}>chrome://extensions</span> so you don&apos;t run two side panels at
          once — the Web Store version replaces it and updates itself from now on.
        </p>
      </div>
    </div>
  );
}
