// Public privacy policy — required by the Chrome Web Store listing for the
// FanBasis Sales extension. Deliberately outside the proxy auth matcher.
export const metadata = { title: "Privacy Policy — FanBasis Sales Ops" };

export default function PrivacyPage() {
  const h2 = "mt-8 mb-2 text-base font-semibold text-[#E2E8F0]";
  const p = "mb-3 text-sm leading-relaxed text-[#94A3B8]";

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-xl font-semibold text-[#E2E8F0]">Privacy Policy</h1>
      <p className="mt-1 mb-6 text-xs text-[#475569]">
        FanBasis Sales Ops — dashboard and Chrome extension · Last updated July 2, 2026
      </p>

      <p className={p}>
        FanBasis Sales Ops is an internal sales tool operated by FanBasis for its own sales team.
        Both the dashboard and the Chrome extension are restricted to invited FanBasis team
        members who sign in with a company Google account.
      </p>

      <h2 className={h2}>What the extension accesses</h2>
      <p className={p}>
        <strong className="text-[#CBD5E1]">Google account basics</strong> — your name and email,
        used solely to sign you in to the FanBasis dashboard.
      </p>
      <p className={p}>
        <strong className="text-[#CBD5E1]">Google Calendar</strong> — free/busy availability and
        event creation, used solely to book sales calls when you ask it to. Granted through
        Google&apos;s consent screen; revocable at any time from your Google account settings.
      </p>
      <p className={p}>
        <strong className="text-[#CBD5E1]">Public prospect information</strong> — public profile
        details (username, name, bio, follower count) from pages you visit on Instagram and
        LinkedIn while using the extension, used solely to track sales leads you choose to save.
      </p>

      <h2 className={h2}>Where data goes</h2>
      <p className={p}>
        Data is sent only to the FanBasis Sales Ops dashboard (unified-sales-ops.vercel.app) and
        stored in FanBasis&apos;s own database. It is used only to operate the sales workflow:
        lead tracking, outreach, follow-ups, and call booking.
      </p>

      <h2 className={h2}>What we don&apos;t do</h2>
      <p className={p}>
        We do not sell or rent data. We do not transfer data to third parties except the service
        providers that host the tool (Vercel, Supabase, Google APIs). We do not use data for
        advertising, creditworthiness determination, or any purpose unrelated to the tool&apos;s
        single purpose: managing FanBasis sales outreach.
      </p>

      <h2 className={h2}>Contact</h2>
      <p className={p}>
        Questions or data requests:{" "}
        <a href="mailto:felipe@fanbasis.com" className="text-[#FF3A69]">
          felipe@fanbasis.com
        </a>
      </p>
    </div>
  );
}
