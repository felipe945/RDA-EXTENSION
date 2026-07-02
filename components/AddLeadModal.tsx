"use client";
import { useState } from "react";

const SOURCES = ["Manual", "IG", "LinkedIn", "Email", "SMS"];

export default function AddLeadModal({ onClose, onAdded }: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [form, setForm] = useState({
    ig_username: "", name: "", phone: "", email: "",
    linkedin_url: "", source: "Manual", notes: ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: string, val: string) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.ig_username && !form.name && !form.email && !form.phone) {
      setError("Need at least a name, IG username, email, or phone.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ig_username: form.ig_username || null,
        name: form.name || form.ig_username || null,
        phone: form.phone || null,
        email: form.email || null,
        linkedin_url: form.linkedin_url || null,
        source: form.source,
        mode: "sales",
        stage: "New",
        notes: form.notes || null,
        due_at: new Date(Date.now() + 48 * 3600000).toISOString(),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError((body as { error?: string }).error ?? "Failed to save.");
      setSaving(false);
      return;
    }
    setSaving(false);
    onAdded();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[#0F1420] border border-[#1A2235] rounded-2xl p-6 w-full max-w-md mx-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Add Lead</h2>
          <button onClick={onClose} className="text-[#5B6B8C] hover:text-[#E2E8F0] transition-colors text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <Field label="IG Username" placeholder="@username" value={form.ig_username}
            onChange={v => set("ig_username", v.replace("@", ""))} />
          <Field label="Full Name" placeholder="John Smith" value={form.name}
            onChange={v => set("name", v)} />
          <Field label="Email" placeholder="email@example.com" value={form.email}
            onChange={v => set("email", v)} type="email" />
          <Field label="Phone" placeholder="+1 (555) 000-0000" value={form.phone}
            onChange={v => set("phone", v)} />
          <Field label="LinkedIn URL" placeholder="https://linkedin.com/in/..." value={form.linkedin_url}
            onChange={v => set("linkedin_url", v)} />

          <div>
            <label className="text-xs text-[#5B6B8C] uppercase tracking-wide block mb-1">Source</label>
            <select
              value={form.source}
              onChange={e => set("source", e.target.value)}
              className="w-full text-sm bg-[#151B2E] border border-[#1A2235] rounded-lg px-3 py-2 text-[#E2E8F0] outline-none focus:border-[#2A3554]"
            >
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs text-[#5B6B8C] uppercase tracking-wide block mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)}
              rows={2} placeholder="How you know them, what they mentioned..."
              className="w-full text-sm bg-[#151B2E] border border-[#1A2235] rounded-lg px-3 py-2 text-[#E2E8F0] outline-none focus:border-[#2A3554] resize-none" />
          </div>

          {error && <p className="text-xs text-[#FCA5C0]">{error}</p>}

          <button type="submit" disabled={saving}
            className="w-full py-2.5 bg-[#FF3A69] hover:bg-[#e03060] text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50">
            {saving ? "Saving..." : "Add Lead"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, placeholder, value, onChange, type = "text" }: {
  label: string; placeholder: string; value: string;
  onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="text-xs text-[#5B6B8C] uppercase tracking-wide block mb-1">{label}</label>
      <input type={type} placeholder={placeholder} value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full text-sm bg-[#151B2E] border border-[#1A2235] rounded-lg px-3 py-2 text-[#E2E8F0] outline-none focus:border-[#2A3554]" />
    </div>
  );
}
