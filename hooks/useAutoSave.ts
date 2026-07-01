"use client";
import { useRef, useCallback, useState, useEffect } from "react";

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

interface UseAutoSaveOptions<T> {
  data: T;
  onSave: (data: T) => Promise<void>;
  delay?: number;
  enabled?: boolean;
}

interface UseAutoSaveReturn {
  status: SaveStatus;
  saveNow: () => void;
  lastSavedAt: Date | null;
  hasUnsavedChanges: boolean;
}

export function useAutoSave<T>({
  data,
  onSave,
  delay = 1500,
  enabled = true,
}: UseAutoSaveOptions<T>): UseAutoSaveReturn {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDataRef = useRef<string>("");
  const isMountedRef = useRef(true);

  const serialized = JSON.stringify(data);

  const performSave = useCallback(async () => {
    if (!isMountedRef.current) return;
    setStatus("saving");
    try {
      await onSave(data);
      if (!isMountedRef.current) return;
      setStatus("saved");
      setLastSavedAt(new Date());
      setHasUnsavedChanges(false);
      lastDataRef.current = serialized;
      setTimeout(() => { if (isMountedRef.current) setStatus("idle"); }, 2000);
    } catch {
      if (isMountedRef.current) setStatus("error");
    }
  }, [data, onSave, serialized]);

  const saveNow = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    void performSave();
  }, [performSave]);

  useEffect(() => {
    if (!enabled || serialized === lastDataRef.current) return;
    setHasUnsavedChanges(true);
    setStatus("pending");
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => { void performSave(); }, delay);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [serialized, delay, enabled, performSave]);

  useEffect(() => {
    isMountedRef.current = true;
    if (!lastDataRef.current) lastDataRef.current = serialized;
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { status, saveNow, lastSavedAt, hasUnsavedChanges };
}
