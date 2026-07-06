"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, X, Check, Calendar, Clock } from "lucide-react";
import type { Lead } from "@/hooks/useLeads";

// Real booking (PARITY G1) — mirrors the extension's flow: open slots come
// from Google freeBusy via /api/calendar/slots, the event + guest invite is
// created by /api/calendar/book, which also stages the lead to Booked
// server-side (scope-checked) and deliberately leaves due_at alone.

type Slot = { start: string; end: string };
type Ae = { id: string; name: string; email: string; active: boolean };
type Step = "date" | "time" | "confirm";
type LoadState = "loading" | "ready" | "needsCalendar" | "aeUnreadable" | "error";

const AE_STORAGE_KEY = "fb-book-ae";

const SLOT_MINS = 45;
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours(), m = d.getMinutes();
  const h12 = h % 12 || 12;
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h12}${m === 0 ? "" : `:${String(m).padStart(2, "0")}`} ${ampm}`;
}

interface Props {
  lead: Lead;
  onClose: () => void;
  onBooked?: () => void;
  // "book" creates the event; "availability" is look-don't-book — pick up to
  // 3 open times and copy them (or a ready DM) to offer in a conversation.
  mode?: "book" | "availability";
}

export default function BookCallModal({ lead, onClose, onBooked, mode = "book" }: Props) {
  const offering = mode === "availability";
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [slots, setSlots] = useState<Slot[]>([]);
  // null = AE list still loading; [] = org has no AEs (fall back to own calendar)
  const [aes, setAes] = useState<Ae[] | null>(null);
  const [aeId, setAeId] = useState<string | null>(null);
  // Calls normally end by 6:15 PM — this override extends the window to 8 PM.
  const [lateTimes, setLateTimes] = useState(false);
  const [step, setStep] = useState<Step>("date");
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [guestEmail, setGuestEmail] = useState(lead.email ?? "");
  const [saving, setSaving] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [done, setDone] = useState<{ htmlLink?: string; leadError?: string } | null>(null);
  const [dmCopied, setDmCopied] = useState(false);
  // Availability mode: times picked to offer (max 3, can span days)
  const [offerPicks, setOfferPicks] = useState<Slot[]>([]);
  const [offerCopied, setOfferCopied] = useState<"" | "times" | "dm">("");

  // Who the call is with — availability comes from the chosen AE's calendar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/aes");
        const data = (await res.json().catch(() => null)) as
          | { ok: boolean; aes?: Ae[] }
          | null;
        if (cancelled) return;
        const list = (data?.ok ? data.aes ?? [] : []).filter((a) => a.active);
        setAes(list);
        if (list.length) {
          const stored = localStorage.getItem(AE_STORAGE_KEY);
          setAeId(list.some((a) => a.id === stored) ? stored : list[0].id);
        }
      } catch {
        if (!cancelled) setAes([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadSlots = useCallback(async (forAe: string | null, late: boolean) => {
    try {
      const ae = forAe ? `&aeId=${forAe}` : "";
      const res = await fetch(`/api/calendar/slots?days=14&slotMins=${SLOT_MINS}${ae}${late ? "&late=1" : ""}`);
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; slots?: Slot[]; needsCalendar?: boolean; error?: string }
        | null;
      if (data?.ok && data.slots) {
        setSlots(data.slots);
        setLoadState("ready");
      } else if (data?.needsCalendar) {
        setLoadState("needsCalendar");
      } else if (data?.error === "ae_calendar_unreadable") {
        setLoadState("aeUnreadable");
      } else {
        setLoadState("error");
      }
    } catch {
      setLoadState("error");
    }
  }, []);

  // (Re)load availability once the AE list has resolved, on AE switch, and
  // when the late-times override flips.
  useEffect(() => {
    if (aes === null) return;
    setLoadState("loading");
    setStep("date");
    setSelectedKey(null);
    setSelectedSlot(null);
    setOfferPicks([]); // picked times belong to the previous slot window
    void loadSlots(aeId, lateTimes);
  }, [aes, aeId, lateTimes, loadSlots]);

  const slotsByDate = useMemo(() => {
    const map: Record<string, Slot[]> = {};
    for (const s of slots) {
      const key = dateKey(new Date(s.start));
      (map[key] ??= []).push(s);
    }
    return map;
  }, [slots]);

  // ── Calendar helpers ─────────────────────────────────────────────────────
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  function keyFor(day: number) {
    return dateKey(new Date(viewYear, viewMonth, day));
  }
  function hasSlots(day: number) {
    return (slotsByDate[keyFor(day)]?.length ?? 0) > 0;
  }
  function isToday(day: number) {
    return today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === day;
  }

  function selectDate(day: number) {
    if (!hasSlots(day)) return;
    setSelectedKey(keyFor(day));
    setStep("time");
  }

  // ── Confirm booking ──────────────────────────────────────────────────────
  const confirm = useCallback(async () => {
    if (!selectedSlot || saving) return;
    setSaving(true);
    setBookError(null);
    try {
      const res = await fetch("/api/calendar/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotStart: selectedSlot.start,
          slotEnd: selectedSlot.end,
          leadName: lead.name ?? lead.ig_username ?? "Lead",
          guestEmail: guestEmail.trim() || undefined,
          leadId: lead.id,
          aeId: aeId ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; htmlLink?: string; leadError?: string; needsCalendar?: boolean; error?: string }
        | null;
      if (data?.ok) {
        setDone({ htmlLink: data.htmlLink, leadError: data.leadError });
        onBooked?.();
      } else if (data?.needsCalendar) {
        setLoadState("needsCalendar");
      } else if (data?.error === "slot_taken") {
        // That window filled up since the picker loaded — pull fresh
        // availability and send them back to pick again.
        setSelectedSlot(null);
        setStep("time");
        setBookError("That time was just taken — availability refreshed, pick another.");
        void loadSlots(aeId, lateTimes);
      } else if (data?.error === "ae_calendar_unreadable") {
        setLoadState("aeUnreadable");
      } else {
        setBookError(data?.error === "forbidden" ? "This lead belongs to a teammate." : "Booking failed — try again.");
      }
    } catch {
      setBookError("Booking failed — network error.");
    } finally {
      setSaving(false);
    }
  }, [selectedSlot, saving, guestEmail, lead, onBooked, loadSlots, aeId, lateTimes]);

  // ── Formatted display ────────────────────────────────────────────────────
  const selectedDate = selectedKey ? new Date(`${selectedKey}T00:00:00`) : null;
  const formattedDate = selectedDate
    ? `${DAYS_LONG[selectedDate.getDay()]}, ${MONTHS[selectedDate.getMonth()]} ${selectedDate.getDate()}`
    : "";

  const name = lead.ig_username ? `@${lead.ig_username}` : (lead.name ?? "Lead");
  const currentAe = aes?.find((a) => a.id === aeId) ?? null;

  function pickAe(id: string) {
    localStorage.setItem(AE_STORAGE_KEY, id);
    setAeId(id);
  }

  const dmText = selectedSlot && selectedDate
    ? `Hey! Just sent a calendar invite for ${DAYS_LONG[selectedDate.getDay()]} ${MONTHS_SHORT[selectedDate.getMonth()]} ${selectedDate.getDate()} at ${fmtTime(selectedSlot.start)} — ${SLOT_MINS} min, no pressure. Let me know if that time works!`
    : "";

  // ── Availability mode: offer-times text + copy ────────────────────────────
  function shortSlot(s: Slot) {
    const d = new Date(s.start);
    return `${DAYS_LONG[d.getDay()].slice(0, 3)} ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()} at ${fmtTime(s.start)}`;
  }
  const offerTimesText = (() => {
    const texts = [...offerPicks]
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .map(shortSlot);
    if (texts.length <= 1) return texts[0] ?? "";
    if (texts.length === 2) return `${texts[0]} or ${texts[1]}`;
    return `${texts.slice(0, -1).join(", ")}, or ${texts[texts.length - 1]}`;
  })();
  const firstName = lead.name?.trim().split(/\s+/)[0];
  const offerDmText = `Hey${firstName ? ` ${firstName}` : ""} — happy to walk through the dashboard, no pitch, just ${SLOT_MINS} min to show you what it looks like with your numbers.\n\n${currentAe ? "We're" : "I'm"} open ${offerTimesText} — any of those work?`;

  function copyOffer(kind: "times" | "dm") {
    navigator.clipboard.writeText(kind === "dm" ? offerDmText : offerTimesText).then(() => {
      setOfferCopied(kind);
      setTimeout(() => setOfferCopied(""), 2000);
    });
  }

  function togglePick(slot: Slot) {
    setOfferPicks((prev) =>
      prev.some((p) => p.start === slot.start)
        ? prev.filter((p) => p.start !== slot.start)
        : prev.length >= 3 ? prev : [...prev, slot]
    );
  }

  const offerFooter = offering && loadState === "ready" && (
    <div className="mt-4 pt-3" style={{ borderTop: "1px solid #1A2235" }}>
      {offerPicks.length === 0 ? (
        <p className="text-xs text-center" style={{ color: "#475569" }}>
          Pick up to 3 times to offer — across any days.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {offerPicks.map((p) => (
              <button
                key={p.start}
                onClick={() => togglePick(p)}
                title="Remove"
                className="px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors"
                style={{ background: "rgba(255,58,105,0.1)", border: "1px solid rgba(255,58,105,0.35)", color: "#FF7A9C" }}
              >
                {shortSlot(p)} ✕
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => copyOffer("times")}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all"
              style={{ background: "#151B2E", border: "1px solid #2A3554", color: offerCopied === "times" ? "#4ade80" : "#94A3B8" }}
            >
              {offerCopied === "times" ? "✓ Copied!" : "Copy times"}
            </button>
            <button
              onClick={() => copyOffer("dm")}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all"
              style={{ background: "#FF3A69", color: "white" }}
            >
              {offerCopied === "dm" ? "✓ Copied!" : "Copy DM"}
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(3,7,18,0.85)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden"
        style={{ background: "#0F1420", border: "1px solid #2A3554", boxShadow: "0 24px 80px rgba(0,0,0,0.8)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #1A2235" }}>
          <div>
            <div className="text-sm font-semibold" style={{ color: "#E2E8F0" }}>
              {offering ? "See Availability" : "Book a Call"}
            </div>
            <div className="text-xs mt-0.5" style={{ color: "#475569" }}>
              {offering ? `offer times · ${name}` : `${SLOT_MINS} min · ${name}`}
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{ background: "#1A2235", color: "#475569" }}
            onMouseEnter={e => { (e.currentTarget).style.color = "#94A3B8"; }}
            onMouseLeave={e => { (e.currentTarget).style.color = "#475569"; }}>
            <X size={14} />
          </button>
        </div>

        {/* Step indicator */}
        {loadState === "ready" && !done && (
          <div className="flex px-5 pt-4 gap-1.5">
            {((offering ? ["date", "time"] : ["date", "time", "confirm"]) as Step[]).map((s) => (
              <div key={s} className="h-0.5 flex-1 rounded-full transition-all duration-300"
                style={{ background: step === s || (s === "date" && step !== "date") || (s === "time" && step === "confirm")
                  ? "#FF3A69" : "#1A2235" }} />
            ))}
          </div>
        )}

        <div className="p-5">

          {/* ── AE selector — whose real availability the calendar shows ── */}
          {!done && (aes?.length ?? 0) > 0 && (
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs flex-shrink-0" style={{ color: "#475569" }}>Call with</span>
              <select
                value={aeId ?? ""}
                onChange={(e) => pickAe(e.target.value)}
                aria-label="Account Executive for this call"
                className="flex-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none"
                style={{ background: "#151B2E", border: "1px solid #2A3554", color: "#E2E8F0" }}
              >
                {aes!.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* ── Late-times override — calls normally end by 6:15 PM ── */}
          {!done && (
            <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={lateTimes}
                onChange={(e) => setLateTimes(e.target.checked)}
                className="cursor-pointer"
                style={{ accentColor: "#FF3A69" }}
              />
              <span className="text-xs" style={{ color: lateTimes ? "#94A3B8" : "#475569" }}>
                🌙 Late times — allow calls past 6:15 PM
              </span>
            </label>
          )}

          {/* ── Loading / calendar-not-connected / error ── */}
          {loadState === "loading" && (
            <div className="py-10 text-center">
              <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: "#FF3A69" }} />
              <p className="text-xs mt-3" style={{ color: "#475569" }}>
                {currentAe ? `Checking ${currentAe.name}'s live availability…` : "Checking your Google Calendar…"}
              </p>
            </div>
          )}

          {loadState === "aeUnreadable" && (
            <div className="py-8 text-center space-y-3">
              <Calendar size={22} style={{ color: "#475569", margin: "0 auto" }} />
              <p className="text-sm font-semibold" style={{ color: "#E2E8F0" }}>
                Can&apos;t see {currentAe?.name ?? "this AE"}&apos;s calendar
              </p>
              <p className="text-xs leading-relaxed" style={{ color: "#475569" }}>
                Their Google Calendar isn&apos;t sharing free/busy with your account. Ask them to enable
                &quot;See only free/busy&quot; sharing for the fanbasis.com domain (Google Calendar → Settings),
                or pick a different AE above.
              </p>
            </div>
          )}

          {loadState === "needsCalendar" && (
            <div className="py-8 text-center space-y-3">
              <Calendar size={22} style={{ color: "#475569", margin: "0 auto" }} />
              <p className="text-sm font-semibold" style={{ color: "#E2E8F0" }}>Calendar not connected</p>
              <p className="text-xs leading-relaxed" style={{ color: "#475569" }}>
                Your Google sign-in doesn&apos;t include calendar access yet. Sign out and back in
                with Google to grant it — booking works right after.
              </p>
            </div>
          )}

          {loadState === "error" && (
            <div className="py-8 text-center space-y-3">
              <p className="text-sm font-semibold" style={{ color: "#E2E8F0" }}>Couldn&apos;t load availability</p>
              <p className="text-xs" style={{ color: "#475569" }}>Google Calendar didn&apos;t respond. Close and try again.</p>
            </div>
          )}

          {/* ── STEP 1: Date picker (only days with real open slots) ── */}
          {loadState === "ready" && !done && step === "date" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <button onClick={prevMonth} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                  style={{ background: "#151B2E", color: "#94A3B8" }}>
                  <ChevronLeft size={14} />
                </button>
                <span className="text-sm font-semibold" style={{ color: "#E2E8F0" }}>
                  {MONTHS[viewMonth]} {viewYear}
                </span>
                <button onClick={nextMonth} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                  style={{ background: "#151B2E", color: "#94A3B8" }}>
                  <ChevronRight size={14} />
                </button>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 mb-1">
                {DAYS.map(d => (
                  <div key={d} className="text-center text-[10px] font-semibold pb-2"
                    style={{ color: "#2D3A52", letterSpacing: "0.06em" }}>
                    {d}
                  </div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7 gap-y-1">
                {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`e-${i}`} />)}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                  const available = hasSlots(day);
                  const tod = isToday(day);
                  return (
                    <button
                      key={day}
                      onClick={() => selectDate(day)}
                      disabled={!available}
                      className="relative mx-auto flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-all"
                      style={
                        !available
                          ? { color: "#2D3A52", cursor: "not-allowed" }
                          : tod
                          ? { color: "#FF3A69", background: "rgba(255,58,105,0.08)" }
                          : { color: "#94A3B8" }
                      }
                      onMouseEnter={e => { if (available) (e.currentTarget).style.background = "#1A2235"; }}
                      onMouseLeave={e => { if (available && !tod) (e.currentTarget).style.background = "transparent"; else if (tod) (e.currentTarget).style.background = "rgba(255,58,105,0.08)"; }}
                    >
                      {day}
                      {available && (
                        <span className="absolute left-1/2 -translate-x-1/2" style={{ bottom: 1, width: 4, height: 4, borderRadius: "50%", background: "#FF3A69" }} />
                      )}
                    </button>
                  );
                })}
              </div>
              {offerFooter}
            </div>
          )}

          {/* ── STEP 2: Real open slots for the picked day ── */}
          {loadState === "ready" && !done && step === "time" && selectedKey && (
            <div>
              <button onClick={() => setStep("date")} className="flex items-center gap-1.5 text-xs mb-4 transition-colors"
                style={{ color: "#475569" }}
                onMouseEnter={e => { (e.currentTarget).style.color = "#94A3B8"; }}
                onMouseLeave={e => { (e.currentTarget).style.color = "#475569"; }}>
                <ChevronLeft size={12} /> {formattedDate}
              </button>

              <div className="flex items-center gap-2 mb-3">
                <Clock size={13} style={{ color: "#FF3A69" }} />
                <span className="text-xs font-medium" style={{ color: "#94A3B8" }}>Select a time</span>
              </div>

              {bookError && (
                <p className="text-xs mb-3" style={{ color: "#fbbf24" }}>{bookError}</p>
              )}

              <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                {(slotsByDate[selectedKey] ?? []).map(slot => {
                  const active = offering
                    ? offerPicks.some((p) => p.start === slot.start)
                    : selectedSlot?.start === slot.start;
                  return (
                    <button
                      key={slot.start}
                      onClick={() => {
                        if (offering) togglePick(slot);
                        else { setSelectedSlot(slot); setStep("confirm"); }
                      }}
                      className="py-2.5 rounded-xl text-xs font-semibold transition-all"
                      style={
                        active
                          ? { background: "#FF3A69", color: "white", border: "1px solid #FF3A69" }
                          : { background: "#151B2E", color: "#94A3B8", border: "1px solid #1A2235" }
                      }
                      onMouseEnter={e => { if (!active) { (e.currentTarget).style.borderColor = "#2A3554"; (e.currentTarget).style.color = "#E2E8F0"; } }}
                      onMouseLeave={e => { if (!active) { (e.currentTarget).style.borderColor = "#1A2235"; (e.currentTarget).style.color = "#94A3B8"; } }}
                    >
                      {fmtTime(slot.start)}
                    </button>
                  );
                })}
              </div>
              {offerFooter}
            </div>
          )}

          {/* ── STEP 3: Confirm ── */}
          {loadState === "ready" && !done && step === "confirm" && selectedSlot && (
            <div>
              <button onClick={() => setStep("time")} className="flex items-center gap-1.5 text-xs mb-5 transition-colors"
                style={{ color: "#475569" }}
                onMouseEnter={e => { (e.currentTarget).style.color = "#94A3B8"; }}
                onMouseLeave={e => { (e.currentTarget).style.color = "#475569"; }}>
                <ChevronLeft size={12} /> Change time
              </button>

              {/* Summary card */}
              <div className="rounded-xl p-4 mb-4 space-y-2" style={{ background: "#151B2E", border: "1px solid #1E2640" }}>
                <div className="flex items-center gap-2">
                  <Calendar size={13} style={{ color: "#FF3A69" }} />
                  <span className="text-sm font-semibold" style={{ color: "#E2E8F0" }}>{formattedDate}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock size={13} style={{ color: "#3B82F6" }} />
                  <span className="text-sm font-semibold" style={{ color: "#E2E8F0" }}>{fmtTime(selectedSlot.start)} · {SLOT_MINS} min</span>
                </div>
                <div className="pt-1" style={{ borderTop: "1px solid #1A2235" }}>
                  <span className="text-xs" style={{ color: "#475569" }}>with </span>
                  <span className="text-xs font-semibold" style={{ color: "#94A3B8" }}>{name}</span>
                  {currentAe && (
                    <>
                      <span className="text-xs" style={{ color: "#475569" }}> · AE </span>
                      <span className="text-xs font-semibold" style={{ color: "#94A3B8" }}>{currentAe.name}</span>
                    </>
                  )}
                </div>
              </div>

              <input
                type="email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                placeholder="Their email (optional — adds them as attendee)"
                className="w-full rounded-lg px-3 py-2 text-xs outline-none mb-4 transition-colors"
                style={{ background: "#151B2E", border: "1px solid #2A3554", color: "#CBD5E1" }}
                onFocus={e => { e.currentTarget.style.borderColor = "#3B82F6"; }}
                onBlur={e => { e.currentTarget.style.borderColor = "#2A3554"; }}
              />

              <p className="text-xs mb-4" style={{ color: "#475569" }}>
                Creates a Google Calendar event{currentAe ? ` and invites ${currentAe.name}` : ""}, then moves the lead to{" "}
                <span style={{ color: "#22C55E", fontWeight: 600 }}>Booked</span>. Your follow-up date stays as-is.
              </p>

              {bookError && (
                <p className="text-xs mb-3" style={{ color: "#f87171" }}>{bookError}</p>
              )}

              <button
                onClick={confirm}
                disabled={saving}
                className="w-full py-3 rounded-xl text-sm font-bold transition-all"
                style={{ background: "#FF3A69", color: "white", opacity: saving ? 0.7 : 1 }}
              >
                {saving ? "Booking…" : "Confirm Booking"}
              </button>
            </div>
          )}

          {/* ── Done state ── */}
          {done && (
            <div className="flex flex-col items-center justify-center py-6 gap-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)" }}>
                <Check size={22} style={{ color: "#22C55E" }} />
              </div>
              <p className="text-sm font-semibold" style={{ color: "#E2E8F0" }}>Call booked!</p>
              <p className="text-xs text-center" style={{ color: "#475569" }}>{formattedDate} at {selectedSlot ? fmtTime(selectedSlot.start) : ""}</p>
              {done.leadError && (
                <p className="text-xs text-center" style={{ color: "#fbbf24" }}>
                  Event created, but the stage didn&apos;t update: {done.leadError}
                </p>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(dmText).then(() => {
                      setDmCopied(true);
                      setTimeout(() => setDmCopied(false), 2000);
                    });
                  }}
                  className="px-4 py-2 rounded-lg text-xs transition-all"
                  style={{ background: "#1A2235", border: dmCopied ? "1px solid #166534" : "1px solid #2A3554", color: dmCopied ? "#4ade80" : "#94A3B8" }}
                >
                  {dmCopied ? "✓ Copied!" : "Copy DM text"}
                </button>
                {done.htmlLink && (
                  <a href={done.htmlLink} target="_blank" rel="noreferrer"
                    className="px-4 py-2 rounded-lg text-xs"
                    style={{ background: "#1A2235", border: "1px solid #2A3554", color: "#94A3B8" }}>
                    View event ↗
                  </a>
                )}
              </div>
              <button onClick={onClose} className="text-xs mt-1" style={{ color: "#475569" }}>Close</button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
