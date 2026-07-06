"use client";

import { useMemo, useState } from "react";
import { SCRIPTS, CATEGORY_LABELS, CATEGORY_ORDER, scriptsForStage, type Script } from "@/lib/scripts";

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

// Tiny icon-only copy — for the email subject line, so the card keeps exactly
// ONE labeled Copy (the body).
function CopyIconBtn({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      onClick={copy}
      title={title}
      aria-label={title}
      className={`shrink-0 px-1 text-xs rounded transition-colors ${
        copied ? "text-green-400" : "text-gray-600 hover:text-gray-300"
      }`}
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}

function personalize(text: string, leadName?: string): string {
  return leadName
    ? text.replace(/\[(first\s*)?name\]/gi, leadName)
    : text;
}

function ScriptCard({ script, leadName }: { script: Script; leadName?: string }) {
  const personalized = personalize(script.text, leadName);
  const personalizedSubject = script.subject ? personalize(script.subject, leadName) : undefined;
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
        <CopyBtn text={personalized} />
      </div>

      {isEmail && personalizedSubject && (
        <div className="flex items-center justify-between gap-2 mb-2 px-3 py-2 bg-gray-800 rounded-md border border-gray-700">
          <div className="min-w-0">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider mr-2">Subject</span>
            <span className="text-xs text-gray-300 font-medium">
              <TokenText text={personalizedSubject} />
            </span>
          </div>
          <CopyIconBtn text={personalizedSubject} title="Copy subject" />
        </div>
      )}

      <p className={`text-sm text-gray-400 leading-relaxed ${isEmail ? "whitespace-pre-line" : ""}`}>
        <TokenText text={personalized} />
      </p>
    </div>
  );
}

function ScriptGrid({ scripts, leadName }: { scripts: Script[]; leadName?: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {scripts.map((s) => (
        <ScriptCard key={s.id} script={s} leadName={leadName} />
      ))}
    </div>
  );
}

// Search-first vault: full-width autofocused search on top, a pinned "Top
// scripts" strip, and the 35-card wall folded into collapsed category
// sections. Search results (and the ?stage= section) render flat.
export default function ScriptsVault({
  leadStage,
  leadName,
}: {
  leadStage?: string;
  leadName?: string;
}) {
  const [search, setSearch] = useState("");
  const [openCats, setOpenCats] = useState<Set<Script["category"]>>(new Set());

  const q = search.trim().toLowerCase();

  const results = useMemo(
    () =>
      q
        ? SCRIPTS.filter(
            (s) =>
              s.label.toLowerCase().includes(q) ||
              s.text.toLowerCase().includes(q) ||
              s.subject?.toLowerCase().includes(q)
          )
        : [],
    [q]
  );

  const stageScripts = useMemo(
    () => (leadStage ? scriptsForStage(leadStage) : []),
    [leadStage]
  );

  const featured = SCRIPTS.filter((s) => s.featured);

  function toggleCat(cat: Script["category"]) {
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      {/* Search — the primary way in */}
      <div className="relative">
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search scripts by name or content…"
          className="w-full text-sm bg-gray-900 border border-gray-800 rounded-lg px-3 py-2.5 pl-8 text-gray-200 outline-none focus:border-gray-600 transition-colors"
        />
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 text-sm">⌕</span>
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300 text-sm"
          >
            ✕
          </button>
        )}
      </div>

      {q ? (
        /* Search results — flat */
        <div className="space-y-3">
          <p className="text-xs text-gray-600">
            {results.length} script{results.length !== 1 ? "s" : ""} for &ldquo;{search}&rdquo;
          </p>
          {results.length === 0 ? (
            <p className="text-sm text-gray-600 py-6 text-center">No scripts match &ldquo;{search}&rdquo;.</p>
          ) : (
            <ScriptGrid scripts={results} leadName={leadName} />
          )}
        </div>
      ) : (
        <>
          {/* Stage section — expanded when arriving via "Scripts →" from a lead */}
          {leadStage && stageScripts.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-[#FF3A69] mb-3">
                For {leadStage} <span className="opacity-60">({stageScripts.length})</span>
              </h2>
              <ScriptGrid scripts={stageScripts} leadName={leadName} />
            </section>
          )}

          {/* Pinned Top scripts */}
          {featured.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
                Top scripts <span className="opacity-60">({featured.length})</span>
              </h2>
              <ScriptGrid scripts={featured} leadName={leadName} />
            </section>
          )}

          {/* Collapsed category sections — the wall, foldered */}
          <section className="space-y-2">
            {CATEGORY_ORDER.map((cat) => {
              const scripts = SCRIPTS.filter((s) => s.category === cat);
              if (scripts.length === 0) return null;
              const open = openCats.has(cat);
              return (
                <div key={cat} className="border border-gray-800 rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleCat(cat)}
                    aria-expanded={open}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:bg-gray-900 transition-colors"
                  >
                    <span className="font-medium">{CATEGORY_LABELS[cat]}</span>
                    <span className="flex items-center gap-2 text-xs text-gray-600">
                      {scripts.length}
                      <span className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span>
                    </span>
                  </button>
                  {open && (
                    <div className="p-3 border-t border-gray-800">
                      <ScriptGrid scripts={scripts} leadName={leadName} />
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
