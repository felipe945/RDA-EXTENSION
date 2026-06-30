"use client";
import { useState } from "react";
import type { Lead } from "@/hooks/useLeads";

export default function ResearchPanel({ lead }: { lead: Lead }) {
  if (lead.research_status === "pending") {
    return (
      <div className="flex items-center gap-3 py-12">
        <span className="w-2 h-2 bg-[#FF3A69] rounded-full animate-pulse shrink-0" />
        <span className="text-sm text-gray-400">Analyzing profile… (~30–60 sec)</span>
      </div>
    );
  }

  if (lead.research_status === "error") {
    return (
      <div className="py-10 text-center space-y-2">
        <p className="text-sm text-red-400">Research failed.</p>
        <p className="text-xs text-gray-600">Re-save the lead from the extension to retry.</p>
      </div>
    );
  }

  const cache = lead.research_cache;
  const hasData = cache && Object.keys(cache).length > 0;

  if (!hasData) {
    return (
      <div className="py-12 text-center text-sm text-gray-600">
        No research yet.{" "}
        <span className="text-gray-500">
          Visit the IG profile and click &ldquo;+ Save to Leads&rdquo; in the extension.
        </span>
      </div>
    );
  }

  const fitScore = typeof cache.fitScore === "number" ? cache.fitScore : null;
  const estimatedGmv = typeof cache.estimatedGmv === "number" ? cache.estimatedGmv : null;
  const stack = Array.isArray(cache.stackDetected) ? (cache.stackDetected as string[]) : [];
  const summary = typeof cache.summary === "string" ? cache.summary : null;
  const suggestedOpener = typeof cache.suggestedOpener === "string" ? cache.suggestedOpener : null;
  const fitReason = typeof cache.fitReason === "string" ? cache.fitReason : null;
  const alreadyCustomer = cache.alreadyCustomer === true;

  return (
    <div className="space-y-4">
      {alreadyCustomer && (
        <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
          <p className="text-sm font-semibold text-green-400">✓ Existing FanBasis Customer</p>
          <p className="text-xs text-green-600 mt-0.5">Check Metabase — use expansion play</p>
        </div>
      )}

      {fitScore !== null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 uppercase tracking-wide">Fit Score</span>
            <div className="flex items-center gap-2">
              <span
                className="text-xl font-bold"
                style={{ color: fitScoreColor(fitScore) }}
              >
                {fitScore}
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  color: fitScoreColor(fitScore),
                  background: fitScoreColor(fitScore) + "20",
                }}
              >
                {fitScoreLabel(fitScore)}
              </span>
            </div>
          </div>
          <div className="rounded-full h-1.5" style={{ background: '#1E2640' }}>
            <div
              className="h-1.5 rounded-full transition-all duration-500"
              style={{
                width: `${fitScore}%`,
                background: fitScoreColor(fitScore),
              }}
            />
          </div>
          {fitReason && (
            <p className="text-xs text-gray-500 leading-relaxed">{fitReason}</p>
          )}
        </div>
      )}

      {estimatedGmv !== null && (
        <ResearchRow
          label="Est. Monthly GMV"
          value={`$${estimatedGmv.toLocaleString()}`}
        />
      )}

      {stack.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Detected Stack</p>
          <div className="flex flex-wrap gap-1.5">
            {stack.map((s) => (
              <span
                key={s}
                className="text-xs px-2 py-0.5 rounded-md font-medium" style={{ background: '#151B2E', border: '1px solid #1E2640', color: '#94A3B8' }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {suggestedOpener && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Suggested Opener</p>
          <CopyBlock text={suggestedOpener} />
        </div>
      )}

      {summary && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Sales Brief</p>
          <p className="text-sm text-gray-300 leading-relaxed">{summary}</p>
        </div>
      )}
    </div>
  );
}

function fitScoreColor(score: number) {
  if (score >= 75) return "#22c55e";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function fitScoreLabel(score: number) {
  if (score >= 75) return "Strong Fit";
  if (score >= 50) return "Moderate Fit";
  return "Weak Fit";
}

function ResearchRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b" style={{ borderColor: '#1A2235' }}>
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-200">{value}</span>
    </div>
  );
}

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="relative rounded-xl p-3 pr-16" style={{ background: '#0F1420', border: '1px solid #1A2235' }}>
      <p className="text-sm text-gray-300 leading-relaxed">{text}</p>
      <button
        onClick={copy}
        className="absolute top-2.5 right-2.5 text-xs px-2 py-1 rounded text-[#475569] hover:text-[#CBD5E1] transition-colors" style={{ background: '#1E2640' }}
      >
        {copied ? "✓" : "Copy"}
      </button>
    </div>
  );
}
