"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLead } from "@/hooks/useLeads";
import LeadDetailPanel from "@/components/LeadDetailPanel";
import { IgHandle, igOpenUrl } from "@/components/ig";

export default function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { lead, loading } = useLead(id);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse mr-3" />
        <span className="text-sm text-gray-500">Loading lead...</span>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="text-gray-600 text-sm py-16 text-center">
        Lead not found.{" "}
        <Link href="/" className="text-blue-500 hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const displayName = lead.ig_username
    ? <IgHandle handle={lead.ig_username} className="text-inherit" />
    : (lead.name ?? "Unknown");

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            if (window.history.length > 1) {
              router.back();
            } else {
              router.push("/");
            }
          }}
          className="text-gray-500 hover:text-gray-300 text-sm shrink-0 transition-colors"
          aria-label="Go back"
        >
          &larr;
        </button>
        <h1 className="text-base font-semibold truncate">{displayName}</h1>
        {lead.source && (
          <span className="text-xs bg-gray-800 px-2 py-0.5 rounded text-gray-400 shrink-0">
            {lead.source}
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto shrink-0">
          {igOpenUrl(lead) && (
            <a
              href={igOpenUrl(lead)!}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-pink-500 hover:underline"
            >
              IG &rarr;
            </a>
          )}
          <span className="text-xs bg-gray-800 px-2 py-0.5 rounded text-gray-500">
            {lead.stage}
          </span>
        </div>
      </div>

      {/* Detail panel: Overview / Research / History tabs */}
      <LeadDetailPanel lead={lead} />
    </div>
  );
}
