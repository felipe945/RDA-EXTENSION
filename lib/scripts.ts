export type Script = {
  id: string;
  label: string;
  category: "personal" | "formal" | "fanbasis-acct" | "followup" | "qualification" | "objection" | "pitch" | "email";
  stages: string[];
  text: string;
  subject?: string;
};

export const SCRIPTS: Script[] = [

  // ── PERSONAL OPENERS — from Felipe's personal IG ─────────────────
  // Use these first touch on new leads. Low commitment, feel natural.

  {
    id: "personal-familiar",
    label: "You Look Familiar",
    category: "personal",
    stages: ["New"],
    text: "hey you look very familiar. are you already on fanbasis? would love to offer you aggressive processing rates and a suite of financing options for ur clients",
  },
  {
    id: "personal-mutuals",
    label: "Ton of Mutuals",
    category: "personal",
    stages: ["New"],
    text: "hey [name] see we have a ton of mutuals\ncurious what you're using for processing for your clients would love to offer you an aggressive rate and a suite of financing options for ur customers",
  },
  {
    id: "personal-stripe",
    label: "Noticed Stripe",
    category: "personal",
    stages: ["New"],
    text: "are you already leveraging financing for your offer [name] i see we have some connects also noticed ur using stripe\nwould love to offer you a flat 2.6% processing fee here at fanbasis as well as a suite of financing options for your customers to pay monthly for your high ticket services",
  },
  {
    id: "personal-2pct",
    label: "Flat 2.6% Rate",
    category: "personal",
    stages: ["New"],
    text: "would love to offer you a flat 2.6% processing fee here at fanbasis as well as a suite of financing options for your customers to pay monthly for your high ticket services",
  },
  {
    id: "personal-bnpl-q",
    label: "BNPL Question",
    category: "personal",
    stages: ["New", "DM Sent"],
    text: "Are you currently leveraging any buy now pay laters?",
  },

  // ── FORMAL OPENERS — for bigger / well-known accounts ─────────────
  // Use when the lead has a recognizable brand, platform, or large following.
  // More personalized, more professional tone.

  {
    id: "formal-love-what-built",
    label: "Love What You've Built",
    category: "formal",
    stages: ["New"],
    text: "Hey [name] really love everything you have built over at [company]!\n\nPersonally have used your platform to [use case], but im curious what your payment infrastructure looks like?\n\nAt Fanbasis, we give business owners highly aggressive processing fees, multiple BNPL options so buyers can split up payments (where you get paid in full upfront)\n\nWould love to get you set up as well. Happy to guarantee you lower processing fees and stronger support than your current stack.",
  },
  {
    id: "formal-processing-q",
    label: "What Are You Using For Processing",
    category: "formal",
    stages: ["New"],
    text: "Hey [name] big fan of what you're building.\n\nCurious what your payment setup looks like for [offer]? At FanBasis we give business owners aggressive processing rates + multiple BNPL options so buyers can split payments — you get paid in full upfront.\n\nWould love to get you set up.",
  },

  // ── FANBASIS ACCOUNT — from @FanBasis IG account ──────────────────
  // Send these AFTER the personal DM. Ties the two together and adds credibility.

  {
    id: "fanbasis-acct-main",
    label: "FanBasis Acct Follow-Up",
    category: "fanbasis-acct",
    stages: ["DM Sent"],
    text: "Hey [name] Felipe here! I messaged you off of my personal as well!\n\nHere at FanBasis we give business owners aggressive processing rates, multiple BNPL options so buyers can split payments\n\nWould love to get you set up!",
  },
  {
    id: "fanbasis-acct-bnpl",
    label: "FanBasis Acct — BNPL Angle",
    category: "fanbasis-acct",
    stages: ["DM Sent"],
    text: "Hey [name]! Saw your offer — at FanBasis we let your buyers split payments into 4 installments while you get paid in full upfront.\n\nAlso give business owners aggressive processing rates across the board. Would love to get you set up!",
  },

  // ── FOLLOW-UPS — after DM sent, no reply ──────────────────────────

  {
    id: "fu-value-bump",
    label: "Value + CTA Bump",
    category: "followup",
    stages: ["DM Sent"],
    text: "hey [name]! here at fanbasis we give creators better processing rates, multiple BNPL options so buyers can split payments, and it typically lifts top-line revenue 38%+ within 90 days — all without switching what you're already using. you free for a quick chat?",
  },
  {
    id: "fu-bnpl-stat",
    label: "BNPL Stat Drop",
    category: "followup",
    stages: ["DM Sent"],
    text: "hey! wanted to share one thing — creators at your level are adding $5–15k/mo just from BNPL checkout on fanbasis. recovers ~38% of declined transactions. worth a look?",
  },
  {
    id: "fu-breakup",
    label: "Breakup Message",
    category: "followup",
    stages: ["DM Sent", "Qualifying"],
    text: "no worries at all if the timing's off — i'll leave you alone after this. just wanted to flag that creators at your level are typically adding $5–15k/mo on fanbasis. worth a 15-min call if ever curious.",
  },

  // ── QUALIFICATION ─────────────────────────────────────────────────

  {
    id: "qual-gmv",
    label: "Revenue Qualifier",
    category: "qualification",
    stages: ["DM Sent", "Qualifying"],
    text: "what's your rough monthly revenue from your audience right now? just trying to see if fanbasis would actually move the needle for you.",
  },
  {
    id: "qual-stack",
    label: "Stack Qualifier",
    category: "qualification",
    stages: ["Qualifying"],
    text: "are you using shopify, kajabi, stripe, or any other platform right now? just trying to understand your current setup before i say anything.",
  },
  {
    id: "qual-pain",
    label: "Pain Qualifier",
    category: "qualification",
    stages: ["Qualifying"],
    text: "what's the biggest friction you're hitting with monetization right now — more products, more buyers, or more checkout conversions?",
  },
  {
    id: "qual-fulltime",
    label: "Full Time Question",
    category: "qualification",
    stages: ["DM Sent", "Qualifying"],
    text: "you doing this full time or still scaling out of something else?",
  },

  // ── OBJECTIONS ────────────────────────────────────────────────────

  {
    id: "obj-platform",
    label: "Already Using X",
    category: "objection",
    stages: ["Qualifying", "Call Offered"],
    text: "totally makes sense — most creators we work with came from [platform]. fanbasis specifically adds BNPL which recovers about 38% of declined transactions. that's hard to find anywhere else.",
  },
  {
    id: "obj-timing",
    label: "Not Right Now",
    category: "objection",
    stages: ["Qualifying", "Call Offered"],
    text: "100% respect that. would a 5-min async loom work better? i'll send you the numbers for your audience size and you can decide if it's worth revisiting.",
  },
  {
    id: "obj-cost",
    label: "Too Expensive",
    category: "objection",
    stages: ["Qualifying", "Call Offered"],
    text: "fair pushback. the math usually flips fast — if you're doing $10k/mo, even a 20% lift from BNPL is $2k extra monthly. happy to share the calculator?",
  },

  // ── PITCH & BOOK ──────────────────────────────────────────────────

  {
    id: "pitch-call",
    label: "Book a Call",
    category: "pitch",
    stages: ["Call Offered", "Qualifying"],
    text: "love the convo — you free for a quick 15-min call this week? i can show you exactly what the numbers would look like for your audience.",
  },
  {
    id: "pitch-loom",
    label: "Send Loom",
    category: "pitch",
    stages: ["Call Offered", "Qualifying"],
    text: "i'll send you a 3-min loom showing exactly how it works for creators in your niche — no pitch, just the numbers. cool?",
  },
  {
    id: "pitch-social-proof",
    label: "Social Proof Close",
    category: "pitch",
    stages: ["Call Offered"],
    text: "fanbasis is at $1B+/year GMV across 20,000+ sellers — 38% top-line lift from BNPL within 90 days is the average. happy to intro you to a creator in your niche who's already on it.",
  },
  {
    id: "pitch-time-close",
    label: "Specific Time Close",
    category: "pitch",
    stages: ["Call Offered", "Qualifying"],
    text: "you free for a chat tomorrow at 2pm EST? keeps it quick, i just want to show you what this looks like for your setup specifically.",
  },

  // ── EMAIL TEMPLATES ───────────────────────────────────────────────

  {
    id: "email-cold-1",
    label: "Quick Math",
    category: "email",
    stages: ["New", "Warming"],
    subject: "quick math for [first name]",
    text: `Hey [First Name],

Running [course / coaching] at your level?

Creators similar to you are recovering 38% of declined transactions just by adding BNPL checkout — that's an extra $5–15k/mo without changing anything about your offer.

FanBasis plugs into whatever you're already using. Worth a 15-min call?

— Felipe
FanBasis`,
  },
  {
    id: "email-cold-2",
    label: "Your Checkout",
    category: "email",
    stages: ["New", "Warming"],
    subject: "your [offer name] checkout",
    text: `Hey [First Name],

Saw your [offer] — noticed you're running it on [platform].

One thing that moves the needle fast for creators in your space: BNPL checkout. Buyers split into 4 payments, you get paid in full same day, and declined transactions drop by 38%.

FanBasis handles all of it. 2 minutes to take a look?

— Felipe`,
  },
  {
    id: "email-cold-3",
    label: "What [Platform] Doesn't Do",
    category: "email",
    stages: ["New", "Warming"],
    subject: "what [Kajabi / Stripe] doesn't do",
    text: `Hey [First Name],

[Kajabi] is solid — but it doesn't offer BNPL at checkout.

Creators who add FanBasis alongside their current platform are seeing 38% more revenue within 90 days. It doesn't replace what you're using, just recovers what you're losing.

15 min? I'll show you exactly what the numbers look like for your audience size.

— Felipe`,
  },
  {
    id: "email-cold-4",
    label: "1B+ a Year",
    category: "email",
    stages: ["New"],
    subject: "$1B+ a year",
    text: `Hey [First Name],

FanBasis processes $1B+ annually across 20,000+ creators — mostly coaches, consultants, and course sellers in your space.

The common thread: BNPL checkout that recovers ~38% of declined transactions and adds $5–15k/mo for creators at your level.

Worth a quick chat?

— Felipe
FanBasis`,
  },
  {
    id: "email-fu-1",
    label: "Follow-Up #1 — Bump",
    category: "email",
    stages: ["DM Sent", "Warming"],
    subject: "re: quick math for [first name]",
    text: `Hey [First Name],

Bumping this — know you're busy.

One sentence: BNPL checkout on FanBasis recovers 38% of declined transactions. For most creators we work with, that's $5k+ a month left on the table right now.

15 min this week?

— Felipe`,
  },
  {
    id: "email-fu-2",
    label: "Follow-Up #2 — Different Angle",
    category: "email",
    stages: ["DM Sent", "Warming"],
    subject: "one more thing",
    text: `Hey [First Name],

One more thing before I leave you alone:

Most creators in the [coaching/course] space are on Kajabi, Teachable, or Stripe — none offer BNPL natively. FanBasis is the only checkout that gives your buyers 4-installment options while you get paid in full, same day.

That's the gap we fill. Easy to reply here if it clicks.

— Felipe`,
  },
  {
    id: "email-fu-3",
    label: "Follow-Up #3 — Social Proof",
    category: "email",
    stages: ["DM Sent", "Warming"],
    subject: "creators in your space are doing this",
    text: `Hey [First Name],

Quick one — [Creator Name] in the [niche] space just hit a 40% revenue lift in their first 60 days on FanBasis, just from BNPL checkout.

They were on [platform] before and kept it. FanBasis just handles the checkout layer.

I can intro you directly if you'd like to hear it from them. Open to it?

— Felipe`,
  },
  {
    id: "email-breakup",
    label: "Breakup Email",
    category: "email",
    stages: ["DM Sent", "Qualifying"],
    subject: "closing your file",
    text: `Hey [First Name],

Going to stop following up after this — I know your inbox is full.

If you're ever losing sleep over declined transactions or cart abandonment, FanBasis is the answer. $1B+ GMV, 38% average lift. We're not going anywhere.

Take care,
Felipe
FanBasis`,
  },
  {
    id: "email-obj-timing",
    label: "Objection — Not Right Time",
    category: "email",
    stages: ["Qualifying", "Call Offered"],
    subject: "totally fair — one thing before I go",
    text: `Hey [First Name],

Totally respect that — timing is everything.

Would a 3-min Loom work better? I'll record exactly what the lift looks like for your audience size, no call needed, and you can revisit whenever it makes sense.

Just say the word.

— Felipe`,
  },
  {
    id: "email-obj-cost",
    label: "Objection — Cost",
    category: "email",
    stages: ["Qualifying", "Call Offered"],
    subject: "the math usually flips fast",
    text: `Hey [First Name],

Fair pushback on cost.

Here's the quick math: if you're doing $10k/mo, a 38% lift from BNPL is $3,800 extra monthly. FanBasis pays for itself in the first few days.

Happy to share a calculator specific to your numbers — no call, just a quick breakdown. Want it?

— Felipe`,
  },
  {
    id: "email-reengagement",
    label: "Re-Engagement",
    category: "email",
    stages: ["Archived"],
    subject: "still relevant?",
    text: `Hey [First Name],

We chatted a while back about FanBasis — checking in. Are you still running [the offer] or has your focus shifted?

No agenda, just want to make sure I'm sending you relevant stuff.

— Felipe`,
  },
  {
    id: "email-from-dm",
    label: "DM → Email Transition",
    category: "email",
    stages: ["Qualifying", "Call Offered"],
    subject: "sending this over from our DM",
    text: `Hey [First Name],

As promised — FanBasis in one line: BNPL checkout that recovers 38% of declined transactions, $1B+ GMV across 20k+ sellers.

Calendar link below — happy to find a time that works:
[CALENDAR LINK]

Or just reply here and we'll sort it.

— Felipe`,
  },
];

export const CATEGORY_LABELS: Record<Script["category"], string> = {
  "personal":      "Personal DMs",
  "formal":        "Formal Openers",
  "fanbasis-acct": "FanBasis Account",
  "followup":      "Follow-Ups",
  "qualification": "Qualification",
  "objection":     "Objections",
  "pitch":         "Pitch & Book",
  "email":         "Email Templates",
};

export const CATEGORY_ORDER: Script["category"][] = [
  "personal", "formal", "fanbasis-acct", "followup", "qualification", "objection", "pitch", "email",
];

export function scriptsForStage(stage: string): Script[] {
  return SCRIPTS.filter((s) => s.stages.includes(stage));
}
