"use client";
import Link from "next/link";
import Logo from "@/components/Logo";
import { usePathname } from "next/navigation";
import { useMode } from "@/components/ModeProvider";
import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { canViewPulse } from "@/lib/permissions";
import { LayoutGrid, Send, BookOpen, Users, Puzzle, Radar } from "lucide-react";

// /inbox stays routable but is hidden from the nav until reply detection
// produces real messages — an always-empty inbox erodes trust in the rest.
// Accounts (Pulse) is the nav's first role-gated item: OWNER only (Felipe's
// private watchdog — admins must not see it either). The hide here is
// cosmetic; the real guard is /api/am/* 401ing everyone but the owner.
const NAV_LINKS = [
  { href: "/",                   label: "Dashboard", icon: LayoutGrid },
  { href: "/outreach",           label: "Outreach",  icon: Send },
  { href: "/scripts",            label: "Scripts",   icon: BookOpen },
  { href: "/accounts",           label: "Accounts",  icon: Radar, adminOnly: true },
  { href: "/settings/team",      label: "Team",      icon: Users },
  { href: "/settings/extension", label: "Extension", icon: Puzzle },
];

type NotifCounts = { overdue: number; replied: number; unread: number; pulseRed: number };

export default function Nav() {
  const pathname = usePathname();
  const { mode } = useMode();
  const { data: session } = useSession();
  const isAdmin = canViewPulse(session?.role);
  const [counts, setCounts] = useState<NotifCounts>({ overdue: 0, replied: 0, unread: 0, pulseRed: 0 });

  useEffect(() => {
    async function loadCounts() {
      try {
        const res = await fetch(`/api/notifications?mode=${mode}`);
        if (!res.ok) return;
        const { overdue = [], notifications = [] } = await res.json() as {
          overdue?: unknown[];
          notifications?: unknown[];
        };
        const notifs = notifications as { type?: string }[];
        const unread = notifs.filter(n => n.type?.endsWith("_reply") || n.type === "replied").length;
        const replied = notifs.filter(n => n.type === "replied" || n.type === "ig_reply").length;

        // Pulse fires badge — admin-only endpoint; piggybacks this same tick.
        let pulseRed = 0;
        if (isAdmin) {
          try {
            const pulse = await fetch("/api/am/conversations?view=counts");
            if (pulse.ok) pulseRed = (await pulse.json())?.counts?.red ?? 0;
          } catch {}
        }
        setCounts({ overdue: (overdue as unknown[]).length, replied, unread, pulseRed });
      } catch {}
    }

    loadCounts();
    const interval = setInterval(loadCounts, 60_000);
    return () => clearInterval(interval);
  }, [mode, isAdmin]);

  const urgentCount = counts.overdue + counts.replied;

  // The sign-in screen is full-bleed — don't render the app chrome there.
  if (pathname === "/login") return null;

  return (
    <aside className="w-56 shrink-0 flex flex-col min-h-screen sticky top-0 h-screen overflow-y-auto"
      style={{ background: '#0A0E1A', borderRight: '1px solid #1A2235' }}>

      {/* Logo / Brand */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b" style={{ borderColor: '#1A2235' }}>
        <Logo size={30} showWordmark />
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 pt-3 space-y-0.5">
        {NAV_LINKS.filter(l => !l.adminOnly || isAdmin).map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));
          const badge = href === "/" && urgentCount > 0 ? urgentCount
            : href === "/accounts" && counts.pulseRed > 0 ? counts.pulseRed
            : null;
          return (
            <Link key={href} href={href}
              title={badge !== null && href === "/" ? `${counts.overdue} overdue + ${counts.replied} replied`
                : badge !== null ? `${counts.pulseRed} client fire${counts.pulseRed === 1 ? "" : "s"}`
                : undefined}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors relative"
              style={isActive
                ? { background: 'rgba(59,130,246,0.12)', color: '#60A5FA' }
                : { color: '#475569' }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = '#94A3B8'; }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = '#475569'; }}>
              <Icon size={16} strokeWidth={1.75} />
              {label}
              {badge !== null && (
                <span className="ml-auto min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white rounded-full flex items-center justify-center"
                  style={{ background: '#FF3A69' }}>
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Account + Gmail status + sign out at bottom */}
      <div className="px-3 py-3 border-t space-y-2" style={{ borderColor: '#1A2235' }}>
        {session?.user?.email && (
          <div className="flex items-center justify-between px-3 py-1.5 text-xs" style={{ color: '#94A3B8' }}>
            <span className="truncate" title={session.user.email}>{session.user.email}</span>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="ml-2 shrink-0 transition-colors"
              style={{ color: '#2D3A52' }}
              onMouseEnter={e => { (e.currentTarget).style.color = '#E2E8F0'; }}
              onMouseLeave={e => { (e.currentTarget).style.color = '#2D3A52'; }}
            >
              Sign out
            </button>
          </div>
        )}
        {session?.access_token ? (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: '#0F1420' }}>
            <span className="text-xs font-medium" style={{ color: '#22C55E' }}>Gmail ✓</span>
            <button onClick={() => signOut()} className="text-xs transition-colors" style={{ color: '#2D3A52' }}
              onMouseEnter={e => { (e.target as HTMLElement).style.color = '#94A3B8'; }}
              onMouseLeave={e => { (e.target as HTMLElement).style.color = '#2D3A52'; }}>
              sign out
            </button>
          </div>
        ) : (
          <button onClick={() => signIn("google")}
            className="w-full text-xs px-3 py-2 rounded-lg border transition-colors text-left"
            style={{ borderColor: '#1A2235', color: '#475569' }}
            onMouseEnter={e => { (e.currentTarget).style.borderColor = '#2A3554'; (e.currentTarget).style.color = '#94A3B8'; }}
            onMouseLeave={e => { (e.currentTarget).style.borderColor = '#1A2235'; (e.currentTarget).style.color = '#475569'; }}>
            Connect Gmail →
          </button>
        )}
      </div>
    </aside>
  );
}
