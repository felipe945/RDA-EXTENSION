"use client";
import { useMemo, useRef, useState } from "react";

// Fields the importer can populate. Order = display order in the mapping UI.
const TARGET_FIELDS = [
  { key: "ig_username", label: "IG Username" },
  { key: "name", label: "Full Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "linkedin_url", label: "LinkedIn URL" },
  { key: "external_url", label: "Website / Link" },
  { key: "twitter_username", label: "Twitter" },
  { key: "notes", label: "Notes" },
  { key: "source", label: "Source" },
] as const;

type TargetKey = (typeof TARGET_FIELDS)[number]["key"];

// Header synonyms → target field for auto-mapping.
const SYNONYMS: Record<TargetKey, string[]> = {
  ig_username: ["ig", "instagram", "ig_username", "username", "handle", "ig handle", "instagram handle"],
  name: ["name", "full name", "full_name", "display name", "contact", "contact name"],
  email: ["email", "e-mail", "email address", "mail"],
  phone: ["phone", "phone number", "mobile", "cell", "tel", "number"],
  linkedin_url: ["linkedin", "linkedin url", "linkedin_url", "li", "linkedin profile"],
  external_url: ["website", "url", "link", "external_url", "link in bio", "site", "web"],
  twitter_username: ["twitter", "x", "twitter handle", "twitter_username"],
  notes: ["notes", "note", "comment", "comments", "description", "bio"],
  source: ["source", "channel"],
};

type Preview = { new: number; existing: number; invalid: number; duplicateInFile: number; total: number };
type ImportResult = {
  inserted: number; updated: number; skipped: number; invalid: number;
  total: number; researchQueued: number; errors: string[];
};

// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped "" quotes,
// commas inside quotes, and CRLF/LF line endings. No external dependency.
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^﻿/, ""); // strip BOM

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  const headers = rows.shift() ?? [];
  return { headers: headers.map((h) => h.trim()), rows };
}

function autoMap(headers: string[]): Record<TargetKey, number> {
  const map = {} as Record<TargetKey, number>;
  for (const { key } of TARGET_FIELDS) {
    const syns = SYNONYMS[key];
    const idx = headers.findIndex((h) => syns.includes(h.trim().toLowerCase()));
    map[key] = idx; // -1 if unmapped
  }
  return map;
}

export default function ImportLeadsModal({ onClose, onImported }: {
  onClose: () => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<TargetKey, number>>({} as Record<TargetKey, number>);
  const [onConflict, setOnConflict] = useState<"skip" | "update">("skip");
  const [research, setResearch] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function loadFile(file: File) {
    setError(null); setPreview(null); setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const { headers: h, rows } = parseCsv(String(reader.result ?? ""));
      if (!h.length) { setError("Couldn't read any columns from that file."); return; }
      setFileName(file.name);
      setHeaders(h);
      setDataRows(rows);
      setMapping(autoMap(h));
    };
    reader.onerror = () => setError("Failed to read the file.");
    reader.readAsText(file);
  }

  // Build the mapped lead objects from current mapping.
  const mappedLeads = useMemo(() => {
    if (!headers.length) return [];
    return dataRows.map((r) => {
      const obj: Record<string, string> = {};
      for (const { key } of TARGET_FIELDS) {
        const idx = mapping[key];
        if (idx != null && idx >= 0) obj[key] = (r[idx] ?? "").trim();
      }
      return obj;
    });
  }, [dataRows, headers, mapping]);

  const igMapped = mapping.ig_username != null && mapping.ig_username >= 0;

  async function call(dryRun: boolean) {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/leads/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads: mappedLeads, onConflict, research, dryRun }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError((body as { error?: string }).error ?? "Request failed."); return null; }
      return body;
    } catch {
      setError("Network error.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    const body = await call(true);
    if (body?.preview) setPreview(body.preview);
  }

  async function runImport() {
    const body = await call(false);
    if (body?.ok) { setResult(body as ImportResult); onImported(); }
  }

  function reset() {
    setFileName(null); setHeaders([]); setDataRows([]); setMapping({} as Record<TargetKey, number>);
    setPreview(null); setResult(null); setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-lg mx-4 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Import Leads</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">&times;</button>
        </div>

        {/* Step 1: file */}
        {!headers.length && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) loadFile(f);
            }}
            onClick={() => fileRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              dragOver ? "border-[#FF3A69] bg-[#FF3A69]/5" : "border-gray-700 hover:border-gray-500"
            }`}
          >
            <p className="text-sm text-gray-300">Drop a CSV here, or click to choose</p>
            <p className="text-xs text-gray-600 mt-1">First row must be column headers</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }}
            />
          </div>
        )}

        {/* Step 2: mapping (hidden once we have a result) */}
        {headers.length > 0 && !result && (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">
                <span className="text-gray-200">{fileName}</span> · {dataRows.length} rows
              </span>
              <button onClick={reset} className="text-gray-500 hover:text-gray-300">Choose another file</button>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Column mapping</p>
              {TARGET_FIELDS.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2">
                  <label className="text-xs text-gray-400 w-28 shrink-0">{label}</label>
                  <select
                    value={mapping[key] ?? -1}
                    onChange={(e) => { setMapping((m) => ({ ...m, [key]: Number(e.target.value) })); setPreview(null); }}
                    className="flex-1 text-sm bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-gray-200 outline-none"
                  >
                    <option value={-1}>— none —</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </div>
              ))}
            </div>

            {!igMapped && (
              <p className="text-xs text-amber-400/90">
                No IG Username mapped — rows can&apos;t be de-duplicated against Instagram saves and may create duplicates.
              </p>
            )}

            {/* Conflict handling */}
            <div className="space-y-1">
              <p className="text-xs text-gray-500 uppercase tracking-wide">When a lead already exists</p>
              <div className="flex gap-2">
                {(["skip", "update"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => { setOnConflict(v); setPreview(null); }}
                    className={`flex-1 text-xs py-1.5 rounded-lg border transition-colors ${
                      onConflict === v
                        ? "border-[#FF3A69] text-white bg-[#FF3A69]/10"
                        : "border-gray-700 text-gray-400 hover:border-gray-500"
                    }`}
                  >
                    {v === "skip" ? "Skip existing" : "Update existing"}
                  </button>
                ))}
              </div>
            </div>

            {/* Research opt-in */}
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={research}
                onChange={(e) => setResearch(e.target.checked)}
                className="mt-0.5 accent-[#FF3A69]"
              />
              <span className="text-xs text-gray-400">
                Run AI research on imported leads
                <span className="block text-gray-600">
                  Off by default — a large file queues one AI call per new lead. They&apos;ll drain in the background.
                </span>
              </span>
            </label>

            {/* Preview result */}
            {preview && (
              <div className="rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2 text-sm text-gray-300 flex flex-wrap gap-x-4 gap-y-1">
                <span><span className="text-green-400 font-semibold">{preview.new}</span> new</span>
                <span><span className="text-gray-400 font-semibold">{preview.existing}</span> already exist</span>
                {preview.duplicateInFile > 0 && <span><span className="text-amber-400 font-semibold">{preview.duplicateInFile}</span> dup in file</span>}
                {preview.invalid > 0 && <span><span className="text-red-400 font-semibold">{preview.invalid}</span> invalid</span>}
              </div>
            )}

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex gap-2 pt-1">
              {!preview ? (
                <button
                  onClick={runPreview}
                  disabled={busy || !dataRows.length}
                  className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  {busy ? "Checking…" : "Preview"}
                </button>
              ) : (
                <button
                  onClick={runImport}
                  disabled={busy || preview.new === 0 && !(onConflict === "update" && preview.existing > 0)}
                  className="flex-1 py-2.5 bg-[#FF3A69] hover:bg-[#e03060] text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  {busy ? "Importing…" : `Import ${preview.new} new${onConflict === "update" && preview.existing > 0 ? ` · update ${preview.existing}` : ""}`}
                </button>
              )}
            </div>
          </>
        )}

        {/* Step 3: result */}
        {result && (
          <div className="space-y-3">
            <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-1.5 text-sm">
              <p className="text-white font-semibold">Import complete</p>
              <p className="text-gray-300"><span className="text-green-400 font-semibold">{result.inserted}</span> leads added</p>
              {result.updated > 0 && <p className="text-gray-300"><span className="text-blue-400 font-semibold">{result.updated}</span> updated</p>}
              {result.skipped > 0 && <p className="text-gray-400">{result.skipped} skipped (already existed)</p>}
              {result.invalid > 0 && <p className="text-gray-400">{result.invalid} invalid (no name / handle / email / phone)</p>}
              {result.researchQueued > 0 && <p className="text-gray-400">{result.researchQueued} queued for AI research</p>}
              {result.errors?.length > 0 && (
                <div className="pt-1">
                  <p className="text-red-400 text-xs">{result.errors.length} error(s):</p>
                  <ul className="text-xs text-red-400/80 list-disc list-inside max-h-24 overflow-y-auto">
                    {result.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={reset} className="flex-1 py-2.5 border border-gray-700 text-gray-300 hover:border-gray-500 rounded-lg text-sm transition-colors">
                Import another
              </button>
              <button onClick={onClose} className="flex-1 py-2.5 bg-[#FF3A69] hover:bg-[#e03060] text-white font-semibold rounded-lg text-sm transition-colors">
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
