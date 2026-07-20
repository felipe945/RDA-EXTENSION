import { PulseBoard } from "@/components/pulse/PulseBoard";

// Felipe-only (owner/admin) account-management watchdog. The real guard is the
// server: /api/am/conversations 401s non-admins; the client gate in PulseBoard
// is cosmetic, and proxy.ts walls this page for signed-out visitors.
export default function AccountsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold text-[#E2E8F0]">Accounts</h1>
      <p className="mb-6 text-sm text-[#5B6B8C]">
        Slack + WhatsApp watchdog — read-only. It never sends anything; it just makes sure you do.
      </p>
      <PulseBoard />
    </div>
  );
}
