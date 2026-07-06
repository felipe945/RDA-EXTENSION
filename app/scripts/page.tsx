"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ScriptsVault from "@/components/ScriptsVault";

// useSearchParams needs a Suspense boundary so the rest of the page can
// prerender (next docs: api-reference/functions/use-search-params).
function VaultWithStage() {
  const params = useSearchParams();
  // "Scripts →" links from lead detail land here as /scripts?stage=DM+Sent
  const stage = params.get("stage") ?? undefined;
  return <ScriptsVault leadStage={stage} />;
}

export default function ScriptsPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-white mb-1">Scripts Vault</h1>
        <p className="text-sm text-gray-500">
          Search first — or browse by category. Tokens in{" "}
          <span className="text-[#ff7ab5]">[brackets]</span> auto-fill from lead data when opened from a lead.
        </p>
      </div>
      <Suspense fallback={null}>
        <VaultWithStage />
      </Suspense>
    </div>
  );
}
