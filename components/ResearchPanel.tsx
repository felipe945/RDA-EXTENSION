"use client";
import type { Lead } from "@/hooks/useLeads";

// Legacy component — kept for backward compatibility.
// New code should use LeadDetailPanel which contains a full Research tab.
export default function ResearchPanel({ lead }: { lead: Lead }) {
  if (lead.research_status === "pending") {
    return (
      <div className="flex items-center gap-3 py-12">
        <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse shrink-0" />
        <span className="text-sm text-gray-400">Analyzing profile... (~30–60 sec)</span>
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

  return (
    <div className="space-y-1">
      {cache.fit_score != null && (
        <ResearchRow label="Fit Score" value={`${cache.fit_score}/10`} highlight />
      )}
      {cache.gmv_estimate != null && (
        <ResearchRow label="Est. GMV" value={String(cache.gmv_estimate)} />
      )}
      {cache.platform_stack != null && (
        <ResearchRow label="Stack" value={String(cache.platform_stack)} />
      )}
      {cache.existing_customer != null && (
        <ResearchRow
          label="Existing Customer"
          value={cache.existing_customer ? "Yes — check Metabase" : "No"}
        />
      )}
      {cache.bio_summary != null && (
        <ResearchBlock label="Bio Summary" value={String(cache.bio_summary)} />
      )}
      {cache.outreach_angle != null && (
        <ResearchBlock label="Recommended Angle" value={String(cache.outreach_angle)} />
      )}
    </div>
  );
}

function ResearchRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-800">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-sm font-medium ${highlight ? "text-blue-400" : "text-gray-200"}`}>
        {value}
      </span>
    </div>
  );
}

function ResearchBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-3 border-b border-gray-800 space-y-1.5">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-gray-300 leading-relaxed">{value}</p>
    </div>
  );
}
