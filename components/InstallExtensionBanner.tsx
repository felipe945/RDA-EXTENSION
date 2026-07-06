"use client";
// Dismissible "install the extension" nudge for the Dashboard home. The server
// can't tell whether a given browser has the extension, so this is a soft
// prompt the rep dismisses once they've installed (remembered in localStorage).
// Phase 2 idea: auto-hide once this user's extension has hit
// /api/extension/bootstrap (we already record that on sign-in).
import { useEffect, useState } from "react";
import Link from "next/link";
import { Puzzle, X } from "lucide-react";
import { CHROME_STORE_URL } from "@/lib/extension";

const DISMISS_KEY = "fb_ext_banner_dismissed";

export default function InstallExtensionBanner() {
  // Start hidden; only reveal after we've confirmed it isn't dismissed, so it
  // never flashes on a reload for someone who already hid it.
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) !== "1") setShow(true);
  }, []);

  if (!show) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  }

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
      style={{
        borderColor: "#3A2030",
        background: "linear-gradient(90deg, rgba(255,58,105,0.10), rgba(15,20,32,0.4))",
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Puzzle size={18} className="shrink-0 text-[#FF3A69]" />
        <span className="text-sm text-gray-300">
          <span className="font-medium text-white">Install the FanMas extension</span> to save
          leads and book calls right from Instagram.
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <a
          href={CHROME_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-[#FF3A69] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#e03060]"
        >
          <Puzzle size={13} /> Add to Chrome
        </a>
        <Link
          href="/settings/extension"
          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-[#94A3B8] transition-colors hover:text-white"
        >
          Set it up
        </Link>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="rounded-md p-1.5 text-[#64748B] transition-colors hover:text-white"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
