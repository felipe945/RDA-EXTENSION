"use client";
import { createContext, useContext, useEffect, useState } from "react";

type Mode = "sales" | "csm";

type ModeCtx = { mode: Mode; setMode: (m: Mode) => void };
const ModeContext = createContext<ModeCtx>({ mode: "sales", setMode: () => {} });

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<Mode>("sales");

  useEffect(() => {
    const saved = localStorage.getItem("ops-mode");
    if (saved === "csm") setModeState("csm");
  }, []);

  function setMode(m: Mode) {
    setModeState(m);
    localStorage.setItem("ops-mode", m);
  }

  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>;
}

export function useMode() {
  return useContext(ModeContext);
}
