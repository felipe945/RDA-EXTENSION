"use client";
// One-stop extension setup: download the packaged build, load it into Chrome,
// sign in — the extension self-configures from there (prod dashboard URL is
// its default; Google sign-in mints the repToken and pulls settings via
// /api/extension/bootstrap). Also the landing page for the sidepanel's
// "Update available" nudge.
import { useEffect, useState } from "react";
import { Download, Puzzle, LogIn, RefreshCw, Copy, Check } from "lucide-react";

type Latest = { version: string; updatedAt: string };

const ZIP_URL = "/extension/fanbasis-extension.zip";

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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/extension/latest.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.version && setLatest(d))
      .catch(() => {});
  }, []);

  function copyExtensionsUrl() {
    navigator.clipboard.writeText("chrome://extensions").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const kbd = "rounded border border-[#2A3554] bg-[#151B2E] px-1.5 py-0.5 text-xs font-semibold text-[#CBD5E1]";

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
              updated {new Date(latest.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Step n={1} icon={<Download size={15} className="text-[#FF3A69]" />} title="Download & unzip">
          <a
            href={ZIP_URL}
            download
            className="mb-3 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #FF3A69, #C22450)" }}
          >
            <Download size={15} /> Download extension{latest ? ` v${latest.version}` : ""}
          </a>
          <p>
            Unzip it somewhere <strong className="text-[#E2E8F0]">permanent</strong> — like your Documents
            folder. Chrome runs the extension <em>from</em> that <span className={kbd}>fanbasis-extension</span>{" "}
            folder, so don&apos;t delete it or install breaks.
          </p>
        </Step>

        <Step n={2} icon={<Puzzle size={15} className="text-[#60A5FA]" />} title="Load it into Chrome">
          <ol className="list-decimal space-y-1.5 pl-4">
            <li>
              Open{" "}
              <button
                onClick={copyExtensionsUrl}
                className="inline-flex items-center gap-1 rounded border border-[#2A3554] bg-[#151B2E] px-1.5 py-0.5 text-xs font-semibold text-[#CBD5E1] transition-colors hover:border-[#3B4A6E]"
                title="Copy — Chrome blocks direct links to this page"
              >
                chrome://extensions {copied ? <Check size={11} className="text-[#4ade80]" /> : <Copy size={11} />}
              </button>{" "}
              in a new tab (click to copy — paste it in the address bar).
            </li>
            <li>Turn on <span className={kbd}>Developer mode</span> (toggle, top-right).</li>
            <li>Click <span className={kbd}>Load unpacked</span> and select the <span className={kbd}>fanbasis-extension</span> folder you unzipped.</li>
            <li>Pin it: puzzle-piece icon in the toolbar → 📌 next to FanBasis.</li>
          </ol>
        </Step>

        <Step n={3} icon={<LogIn size={15} className="text-[#4ade80]" />} title="Sign in — that's it">
          <p>
            Go to <strong className="text-[#E2E8F0]">instagram.com</strong>, click the FanBasis icon to open
            the side panel, and hit <span className={kbd}>Sign in with Google</span> using your{" "}
            <strong className="text-[#E2E8F0]">@fanbasis.com</strong> account. Everything else configures
            itself — dashboard connection, your leads, calendar booking, and the AE list.
          </p>
          <p className="mt-2 text-xs text-[#5B6B8C]">
            Heads-up: accept your dashboard invite first (sign in here once). The extension uses the same
            account.
          </p>
        </Step>

        <Step n={4} icon={<RefreshCw size={15} className="text-[#A78BFA]" />} title="Updating later">
          <p>
            When the side panel shows <span className={kbd}>Update available</span>, come back here:
            download the new zip, unzip it <strong className="text-[#E2E8F0]">over the same folder</strong>{" "}
            (replace all files), then hit the <span className={kbd}>↻</span> reload arrow on the FanBasis
            card in <span className={kbd}>chrome://extensions</span>.
          </p>
        </Step>
      </div>
    </div>
  );
}
