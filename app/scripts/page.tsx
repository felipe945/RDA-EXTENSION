"use client";

import ScriptsVault from "@/components/ScriptsVault";

export default function ScriptsPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-white mb-1">Scripts Vault</h1>
        <p className="text-sm text-gray-500">
          Click any script to copy. Tokens in{" "}
          <span className="text-[#ff7ab5]">[brackets]</span> auto-fill from lead data when opened from a lead.
        </p>
      </div>
      <ScriptsVault />
    </div>
  );
}
