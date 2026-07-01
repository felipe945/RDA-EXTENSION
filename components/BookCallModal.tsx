"use client";

import { useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, X, Check, Calendar, Clock } from "lucide-react";
import type { Lead } from "@/hooks/useLeads";

// ── Time slots available for booking ──────────────────────────────────────────
const TIME_SLOTS = [
  "9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM",
  "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM",
  "1:00 PM",  "1:30 PM",  "2:00 PM",  "2:30 PM",
  "3:00 PM",  "3:30 PM",  "4:00 PM",  "4:30 PM",
  "5:00 PM",
];

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

type Step = "date" | "time" | "confirm";

interface Props {
  lead: Lead;
  onClose: () => void;
  onBooked?: (date: Date, time: string) => void;
}

export default function BookCallModal({ lead, onClose, onBooked }: Props) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [step, setStep] = useState<Step>("date");
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // ── Calendar helpers ─────────────────────────────────────────────────────
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 60);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  function isDisabled(day: number) {
    const d = new Date(viewYear, viewMonth, day);
    return d < today || d > maxDate;
  }
  function isSelected(day: number) {
    return selectedDate?.getFullYear() === viewYear &&
           selectedDate?.getMonth() === viewMonth &&
           selectedDate?.getDate() === day;
  }
  function isToday(day: number) {
    return today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === day;
  }

  function selectDate(day: number) {
    if (isDisabled(day)) return;
    setSelectedDate(new Date(viewYear, viewMonth, day));
    setStep("time");
  }

  // ── Confirm booking ──────────────────────────────────────────────────────
  const confirm = useCallback(async () => {
    if (!selectedDate || !selectedTime) return;
    setSaving(true);
    try {
      // Build ISO datetime from selected date + time string
      const [timePart, period] = selectedTime.split(" ");
      let [hours, minutes] = timePart.split(":").map(Number);
      if (period === "PM" && hours !== 12) hours += 12;
      if (period === "AM" && hours === 12) hours = 0;
      const dt = new Date(selectedDate);
      dt.setHours(hours, minutes, 0, 0);

      await fetch(`/api/leads`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: lead.id,
          stage: "Booked",
          due_at: dt.toISOString(),
        }),
      });

      setDone(true);
      onBooked?.(dt, selectedTime);
      setTimeout(onClose, 1800);
    } finally {
      setSaving(false);
    }
  }, [selectedDate, selectedTime, lead.id, onBooked, onClose]);

  // ── Formatted display ────────────────────────────────────────────────────
  const formattedDate = selectedDate
    ? selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    : "";

  const name = lead.ig_username ? `@${lead.ig_username}` : (lead.name ?? "Lead");

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
            <div className="text-sm font-semibold" style={{ color: "#E2E8F0" }}>Book a Call</div>
            <div className="text-xs mt-0.5" style={{ color: "#475569" }}>{name}</div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{ background: "#1A2235", color: "#475569" }}
            onMouseEnter={e => { (e.currentTarget).style.color = "#94A3B8"; }}
            onMouseLeave={e => { (e.currentTarget).style.color = "#475569"; }}>
            <X size={14} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex px-5 pt-4 gap-1.5">
          {(["date", "time", "confirm"] as Step[]).map((s, i) => (
            <div key={s} className="h-0.5 flex-1 rounded-full transition-all duration-300"
              style={{ background: step === s || (s === "date" && step !== "date") || (s === "time" && step === "confirm")
                ? "#FF3A69" : "#1A2235" }} />
          ))}
        </div>

        <div className="p-5">

          {/* ── STEP 1: Date picker ── */}
          {step === "date" && (
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
                  const disabled = isDisabled(day);
                  const selected = isSelected(day);
                  const tod = isToday(day);
                  return (
                    <button
                      key={day}
                      onClick={() => selectDate(day)}
                      disabled={disabled}
                      className="mx-auto flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-all"
                      style={
                        selected
                          ? { background: "#FF3A69", color: "white", fontWeight: 700 }
                          : disabled
                          ? { color: "#2D3A52", cursor: "not-allowed" }
                          : tod
                          ? { color: "#FF3A69", background: "rgba(255,58,105,0.08)" }
                          : { color: "#94A3B8" }
                      }
                      onMouseEnter={e => { if (!disabled && !selected) (e.currentTarget).style.background = "#1A2235"; }}
                      onMouseLeave={e => { if (!disabled && !selected && !tod) (e.currentTarget).style.background = "transparent"; else if (tod && !selected) (e.currentTarget).style.background = "rgba(255,58,105,0.08)"; }}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── STEP 2: Time slots ── */}
          {step === "time" && (
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

              <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                {TIME_SLOTS.map(slot => (
                  <button
                    key={slot}
                    onClick={() => { setSelectedTime(slot); setStep("confirm"); }}
                    className="py-2.5 rounded-xl text-xs font-semibold transition-all"
                    style={
                      selectedTime === slot
                        ? { background: "#FF3A69", color: "white", border: "1px solid #FF3A69" }
                        : { background: "#151B2E", color: "#94A3B8", border: "1px solid #1A2235" }
                    }
                    onMouseEnter={e => { if (selectedTime !== slot) { (e.currentTarget).style.borderColor = "#2A3554"; (e.currentTarget).style.color = "#E2E8F0"; } }}
                    onMouseLeave={e => { if (selectedTime !== slot) { (e.currentTarget).style.borderColor = "#1A2235"; (e.currentTarget).style.color = "#94A3B8"; } }}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── STEP 3: Confirm ── */}
          {step === "confirm" && !done && (
            <div>
              <button onClick={() => setStep("time")} className="flex items-center gap-1.5 text-xs mb-5 transition-colors"
                style={{ color: "#475569" }}
                onMouseEnter={e => { (e.currentTarget).style.color = "#94A3B8"; }}
                onMouseLeave={e => { (e.currentTarget).style.color = "#475569"; }}>
                <ChevronLeft size={12} /> Change time
              </button>

              {/* Summary card */}
              <div className="rounded-xl p-4 mb-5 space-y-2" style={{ background: "#151B2E", border: "1px solid #1E2640" }}>
                <div className="flex items-center gap-2">
                  <Calendar size={13} style={{ color: "#FF3A69" }} />
                  <span className="text-sm font-semibold" style={{ color: "#E2E8F0" }}>{formattedDate}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock size={13} style={{ color: "#3B82F6" }} />
                  <span className="text-sm font-semibold" style={{ color: "#E2E8F0" }}>{selectedTime}</span>
                </div>
                <div className="pt-1" style={{ borderTop: "1px solid #1A2235" }}>
                  <span className="text-xs" style={{ color: "#475569" }}>with </span>
                  <span className="text-xs font-semibold" style={{ color: "#94A3B8" }}>{name}</span>
                </div>
              </div>

              <p className="text-xs mb-4" style={{ color: "#475569" }}>
                This will move the lead to <span style={{ color: "#22C55E", fontWeight: 600 }}>Booked</span> and set the follow-up date.
              </p>

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
              <p className="text-xs text-center" style={{ color: "#475569" }}>{formattedDate} at {selectedTime}</p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
