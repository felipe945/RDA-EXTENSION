// Branded invite email, shared by POST /api/invites (create) and
// POST /api/invites/[id] (resend) so the two senders can never drift.
// Returns both parts: `text` mirrors `html` so gmail/send can build a
// multipart/alternative message with a plain-text fallback.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildInviteEmail(opts: {
  inviterName: string;
  role: string;
  email: string;
  inviteUrl: string;
  expiresAt: string;
}): { subject: string; text: string; html: string } {
  const first = opts.inviterName.trim().split(/\s+/)[0] || "A teammate";
  const roleLabel =
    opts.role === "owner" ? "Owner" : opts.role === "admin" ? "Admin" : "Rep";
  const expiryDate = new Date(opts.expiresAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  const subject = `${first} invited you to FanBasis Sales Ops`;

  const extensionUrl = new URL("/settings/extension", opts.inviteUrl).toString();

  const text = [
    `${first} invited you to FanBasis Sales Ops as a ${roleLabel} — the dashboard the team uses for leads, outreach, and booking.`,
    ``,
    `Accept the invite and sign in with this Google account (${opts.email}):`,
    opts.inviteUrl,
    ``,
    `Then grab the Chrome extension (IG lead capture + booking, right on Instagram): ${extensionUrl}`,
    ``,
    `The invite expires ${expiryDate}.`,
  ].join("\n");

  const h = {
    first: escapeHtml(first),
    role: escapeHtml(roleLabel),
    email: escapeHtml(opts.email),
    url: escapeHtml(opts.inviteUrl),
  };

  // Inline styles only — email clients strip <style> blocks.
  const html = `<div style="background:#F5F5F4;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px 28px;color:#0D0D0E;">
    <div style="font-weight:800;font-size:16px;letter-spacing:-0.02em;margin:0 0 20px;">FanBasis <span style="color:#FF3A69;">Sales Ops</span></div>
    <h1 style="font-size:20px;font-weight:700;margin:0 0 10px;color:#0D0D0E;">${h.first} invited you to the team</h1>
    <p style="margin:0 0 18px;color:#3F3F3D;font-size:14px;line-height:1.6;">You&rsquo;ve been added as a <strong>${h.role}</strong> on FanBasis Sales Ops &mdash; the dashboard the team uses for leads, outreach, and booking.</p>
    <a href="${h.url}" style="display:inline-block;background:#FF3A69;color:#ffffff;font-weight:600;font-size:14px;padding:11px 24px;border-radius:6px;text-decoration:none;margin:0 0 18px;">Accept invite &amp; sign in</a>
    <p style="margin:0 0 22px;color:#3F3F3D;font-size:13px;line-height:1.6;">Step 2 (after signing in): install the <a href="${escapeHtml(extensionUrl)}" style="color:#FF3A69;font-weight:600;">Chrome extension</a> &mdash; IG lead capture, outreach queue, and call booking right on Instagram. The setup guide walks you through it in ~2 minutes.</p>
    <p style="font-size:12px;color:#8A8A86;border-top:1px solid #E2E2DF;padding-top:14px;margin:0;line-height:1.7;">Sign in with this Google account (<strong>${h.email}</strong>). The invite expires ${expiryDate}.<br>Button not working? Paste this link into your browser:<br><a href="${h.url}" style="color:#8A8A86;word-break:break-all;">${h.url}</a></p>
  </div>
</div>`;

  return { subject, text, html };
}
