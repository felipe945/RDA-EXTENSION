"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMode } from "@/components/ModeProvider";
import { useSession, signIn, signOut } from "next-auth/react";

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/inbox", label: "Inbox" },
  { href: "/scripts", label: "Scripts" },
  { href: "/summary", label: "Briefing" },
];

export default function Nav() {
  const pathname = usePathname();
  const { mode, setMode } = useMode();
  const { data: session } = useSession();

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-950">
      <div className="flex items-center gap-5">
        <span className="font-semibold text-sm tracking-tight text-white">Unified Sales Ops</span>
        <nav className="flex items-center gap-0.5">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                pathname === href || (href !== "/" && pathname.startsWith(href))
                  ? "bg-gray-800 text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-900"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        {session?.access_token ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-400">✉ Gmail</span>
            <button
              onClick={() => signOut()}
              className="text-xs text-gray-600 hover:text-gray-400"
            >
              sign out
            </button>
          </div>
        ) : (
          <button
            onClick={() => signIn("google")}
            className="text-xs px-2.5 py-1 border border-gray-700 rounded-md text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
          >
            Connect Gmail
          </button>
        )}
        <div className="flex items-center gap-1 bg-gray-900 rounded-lg p-1">
          <button
            onClick={() => setMode("sales")}
            className={`px-4 py-1 rounded-md text-xs font-medium transition-colors ${
              mode === "sales" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Sales
          </button>
          <button
            onClick={() => setMode("csm")}
            className={`px-4 py-1 rounded-md text-xs font-medium transition-colors ${
              mode === "csm" ? "bg-purple-600 text-white" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            CSM
          </button>
        </div>
      </div>
    </header>
  );
}
