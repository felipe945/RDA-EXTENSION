"use client";

import { useState, useMemo } from "react";
import { SCRIPTS, CATEGORY_LABELS, CATEGORY_ORDER, scriptsForStage, type Script } from "@/lib/scripts";

type Filter = Script["category"] | "all" | "stage";

function TokenText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^\]]+\])/).map((part, i) =>
        part.startsWith("[") && part.endsWith("]") ? (
          <span key={i} className="text-[#ff7ab5] bg-pink-950/30 px-0.5 rounded">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={copy}
      className={`shrink-0 text-xs px-3 py-1 rounded border transition-all ${
        copied
          ? "border-green-700 bg-green-900/30 text-green-400"
          : "border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
      }`}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

function ScriptCard({ script, leadName }: { script: Script; leadName?: string }) {
  const personalized = leadName
    ? script.text.replace(/\[name\]/gi, leadName).replace(/\[first name\]/gi, leadName)
    : script.text;

  const personalizedSubject = leadName && script.subject
    ? script.subject.replace(/\[first name\]/gi, leadName).replace(/\[name\]/gi, leadName)
    : script.subject;

  const isEmail = script.category === "email";

  return (
    <div className="group bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <span className="text-xs font-medium text-gray-200">{script.label}</span>
          <span className="ml-2 text-xs text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
            {CATEGORY_LABELS[script.category]}
          </span>
        </div>
        {!isEmail && <CopyBtn text={personalized} />}
      </div>

      {isEmail && personalizedSubject && (
        <div className="flex items-center justify-between gap-2 mb-2 px-3 py-2 bg-gray-800 rounded-md border border-gray-700">
          <div className="min-w-0">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider mr-2">Subject</span>
            <span className="text-xs text-gray-300 font-medium">
              <TokenText text={personalizedSubject} />
            </span>
          </div>
          <CopyBtn text={personalizedSubject} label="Copy" />
        </div>
      )}

      <p className={`text-sm text-gray-400 leading-relaxed ${isEmail ? "whitespace-pre-line" : ""}`}>
        <TokenText text={personalized} />
      </p>

      {isEmail && (
        <div className="mt-3 flex justify-end">
          <CopyBtn text={personalized} label="Copy Body" />
        </div>
      )}
    </div>
  );
}

export default function ScriptsVault({
  leadStage,
  leadName,
  compact = false,
}: {
  leadStage?: string;
  leadName?: string;
  compact?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>(leadStage ? "stage" : "all");
  const [search, setSearch] = useState("");

  const stageScripts = useMemo(
    () => (leadStage ? scriptsForStage(leadStage) : []),
    [leadStage]
  );

  const visible = useMemo(() => {
    let pool = filter === "stage" ? stageScripts : filter === "all" ? SCRIPTS : SCRIPTS.filter((s) => s.category === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      pool = pool.filter((s) => s.label.toLowerCase().includes(q) || s.text.toLowerCase().includes(q));
    }
    return pool;
  }, [filter, search, stageScripts]);

  const tabs: { key: Filter; label: string }[] = [
    ...(leadStage ? [{ key: "stage" as Filter, label: `For ${leadStage} (${stageScripts.length})` }] : []),
    { key: "all", label: "All" },
    ...CATEGORY_ORDER.map((c) => ({ key: c as Filter, label: CATEGORY_LABELS[c] })),
  ];

  return (
    <div className={compact ? "" : "space-y-4"}>
      {/* Tabs + search */}
      <div className={`flex items-center gap-2 flex-wrap ${compact ? "mb-3" : ""}`}>
        <div className="flex items-center gap-1 flex-wrap flex-1">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                filter === key
                  ? "border-gray-500 bg-gray-800 text-white"
                  : "border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search scripts…"
          className="text-xs bg-gray-900 border border-gray-800 rounded px-3 py-1.5 text-gray-300 outline-none focus:border-gray-600 w-40"
        />
      </div>

      {/* Script grid */}
      <div className={`${compact ? "space-y-2" : "grid gap-3 sm:grid-cols-2"}`}>
        {visible.length === 0 ? (
          <p className="text-sm text-gray-600 py-6 text-center col-span-2">
            No scripts match{search ? ` "${search}"` : " this filter"}.
          </p>
        ) : (
          visible.map((s) => <ScriptCard key={s.id} script={s} leadName={leadName ?? undefined} />)
        )}
      </div>
    </div>
  );
}
