"use client";

import Dashboard from "@/components/Dashboard";
import { useMode } from "@/components/ModeProvider";

export default function Home() {
  const { mode } = useMode();
  return <Dashboard mode={mode} />;
}
