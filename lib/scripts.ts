export type Script = {
  id: string;
  label: string;
  category: "opener" | "followup" | "qualification" | "objection" | "pitch" | "email";
  stages: string[];
  text: string;
  subject?: string; // email subject line — only set for email category
};

export const SCRIPTS: Script[] = [

  // ── OPENERS — Mutual feel (no specific name) ──────────────────────
  {
    id: "opener-familiar-1",
    label: "You Look Familiar",
    category: "opener",
    stages: ["New", "Warming"],
    text: "yo you look so familiar, i see we got some connects. trying to figure out where i know you from. are you already on fanbasis?",
  },
  {
    id: "opener-familiar-2",
    label: "Same Circles",
    category: "opener",
    stages: ["New", "Warming"],
    text: "hey, you look really familiar. we've got a bunch of mutual connects so i feel like our paths have crossed somewhere. where do i know you from?",
  },
  {
    id: "opener-familiar-3",
    label: "Name Keeps Coming Up",
    category: "opener",
    stages: ["New", "Warming"],
    text: "yo i keep seeing your name come up and we share a good amount of connects. trying to place where i know you from. what's your main thing?",
  },
  {
    id: "opener-familiar-4",
    label: "What Are You Focused On",
    category: "opener",
    stages: ["New", "Warming"],
    text: "hey, we've got a ton of connects in common, feel like we already know each other. what are you focused on these days?",
  },
  {
    id: "opener-familiar-5",
    label: "Run In Same Circles",
    category: "opener",
    stages: ["New"],
    text: "yo your stuff looks familiar and i'm pretty sure we've got mutual people. where do i know you from?",
  },
  {
    id: "opener-familiar-6",
    label: "Already On FanBasis",
    category: "opener",
    stages: ["New", "Warming"],
    text: "hey, you look familiar and i can't place it, but we definitely run in the same circles. are you on fanbasis already or no?",
  },
  {
    id: "opener-familiar-7",
    label: "What Offer Are You Running",
    category: "opener",
    stages: ["New", "Warming"],
    text: "yo i feel like we've crossed paths before, too many mutual connects for us not to have. what's the main offer you're running?",
  },
  {
    id: "opener-familiar-8",
    label: "Help Me Out",
    category: "opener",
    stages: ["New"],
    text: "this is gonna bug me, we share a bunch of connects and i can't place where i know you from. help me out?",
  },

  // ── OPENERS — Mutual connection (name the real one) ───────────────
  {
    id: "opener-mutual-1",
    label: "Name Drop Mutual",
    category: "opener",
    stages: ["New", "Warming"],
    text: "hey, noticed we both know [mutual], small world. how long you been in the [niche] space?",
  },
  {
    id: "opener-mutual-2",
    label: "Figured I'd Reach Out",
    category: "opener",
    stages: ["New", "Warming"],
    text: "yo we've got a few connects in common so figured i'd reach out properly instead of just lurking. what are you building right now?",
  },
  {
    id: "opener-mutual-3",
    label: "Mutual Follows Both of Us",
    category: "opener",
    stages: ["New", "Warming"],
    text: "hey, [mutual] follows us both and your stuff keeps showing up for me. trying to place where i know you from, what's your main thing?",
  },
  {
    id: "opener-mutual-4",
    label: "Same World",
    category: "opener",
    stages: ["New", "Warming"],
    text: "yo we know a lot of the same people in the [niche] world. you doing this full time or still scaling out of something?",
  },

  // ── OPENERS — Personalized (reference their offer) ────────────────
  {
    id: "opener-offer-1",
    label: "Their Community Looks Solid",
    category: "opener",
    stages: ["New", "Warming"],
    text: "yo the [offer] looks solid, and we've got some mutual connects too. are you running it on fanbasis or something else?",
  },
  {
    id: "opener-offer-2",
    label: "Been Seeing Your Content",
    category: "opener",
    stages: ["New", "Warming"],
    text: "hey, been seeing your [niche] content and noticed we share a few connects. what are you using for payments and the community side right now?",
  },
  {
    id: "opener-offer-3",
    label: "Keep Seeing Their Course",
    category: "opener",
    stages: ["New"],
    text: "yo we've got mutual people and i keep seeing your [offer]. curious where you host the whole thing?",
  },
  {
    id: "opener-offer-4",
    label: "Event Looked Great",
    category: "opener",
    stages: ["New"],
    text: "hey, the [offer] looked great and we run in the same circles. are you selling tickets and the program through one platform or piecing it together?",
  },

  // ── OPENERS — Soft FanBasis qualifier ─────────────────────────────
  {
    id: "opener-qual-1",
    label: "Are You On FanBasis Yet",
    category: "opener",
    stages: ["New", "Warming"],
    text: "yo quick one, we've got a bunch of mutual connects. are you already on fanbasis or have you not heard of it?",
  },
  {
    id: "opener-qual-2",
    label: "Random Q — FanBasis",
    category: "opener",
    stages: ["New", "Warming"],
    text: "hey, feel like i know you from somewhere and we share a lot of connects. random q, but are you on fanbasis yet?",
  },
  {
    id: "opener-qual-3",
    label: "Your Setup Is Built For This",
    category: "opener",
    stages: ["New", "Warming"],
    text: "yo been meaning to reach out, we've got mutuals and your setup looks like exactly what fanbasis is built for. you on it already?",
  },

  // ── FOLLOW-UPS ────────────────────────────────────────────────────
  {
    id: "fu-intro-value",
    label: "Intro + Value + Takeaway",
    category: "followup",
    stages: ["Warming", "DM Sent"],
    text: "hey [name]! here at fanbasis we give creators better processing rates, multiple BNPL options so buyers can split payments, and it typically lifts top-line revenue 38%+ within 90 days — all without switching what you're already using. you free for a quick chat tomorrow at 2pm EST?",
  },
  {
    id: "fu-bnpl-stat",
    label: "BNPL Stat Drop",
    category: "followup",
    stages: ["Warming", "DM Sent"],
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
    text: "are you using shopify, kajabi, or any other platform right now? just trying to understand your current setup before i say anything.",
  },
  {
    id: "qual-pain",
    label: "Pain Question",
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

  // ── PITCH & BOOK ─────────────────────────────────────────────────
  {
    id: "pitch-call",
    label: "Book a Call CTA",
    category: "pitch",
    stages: ["Call Offered"],
    text: "love the convo — you free for a quick 15-min call this week? i can show you exactly what the numbers would look like for your audience.",
  },
  {
    id: "pitch-loom",
    label: "Send Loom Offer",
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
    id: "pitch-tomorrow",
    label: "Specific Time Close",
    category: "pitch",
    stages: ["Call Offered", "Qualifying"],
    text: "you free for a chat tomorrow at 2pm EST? keeps it quick, i just want to show you what this looks like for your setup specifically.",
  },

  // ── EMAIL — Cold Openers ──────────────────────────────────────────
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
    subject: "what [Kajabi / Gumroad] doesn't do",
    text: `Hey [First Name],

[Kajabi] is solid — but it doesn't offer BNPL at checkout.

Creators who add FanBasis alongside their current platform are seeing 38% more revenue within 90 days. It doesn't replace what you're using, just recovers what you're losing.

15 min? I'll show you exactly what the numbers look like for your audience size.

— Felipe`,
  },
  {
    id: "email-cold-4",
    label: "$1B+ a Year",
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

  // ── EMAIL — Follow-Up Sequence ────────────────────────────────────
  {
    id: "email-fu-1",
    label: "Follow-Up #1 (Bump)",
    category: "email",
    stages: ["Warming", "DM Sent"],
    subject: "re: quick math for [first name]",
    text: `Hey [First Name],

Bumping this — know you're busy.

One sentence: BNPL checkout on FanBasis recovers 38% of declined transactions. For most creators we work with, that's $5k+ a month left on the table right now.

15 min this week?

— Felipe`,
  },
  {
    id: "email-fu-2",
    label: "Follow-Up #2 (Different Angle)",
    category: "email",
    stages: ["Warming", "DM Sent"],
    subject: "one more thing",
    text: `Hey [First Name],

One more thing before I leave you alone:

Most creators in the [coaching/course] space are on Kajabi, Teachable, or Gumroad — none of them offer BNPL natively. FanBasis is the only checkout that gives your buyers 4-installment options while you get paid in full, same day.

That's the gap we fill. If it clicks, easy to reply here.

— Felipe`,
  },
  {
    id: "email-fu-3",
    label: "Follow-Up #3 (Social Proof)",
    category: "email",
    stages: ["Warming", "DM Sent"],
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
    stages: ["DM Sent", "Warming", "Qualifying"],
    subject: "closing your file",
    text: `Hey [First Name],

Going to stop following up after this — I know your inbox is full.

If you're ever losing sleep over declined transactions or cart abandonment, FanBasis is the answer. $1B+ GMV, 38% average lift. We're not going anywhere.

Take care,
Felipe
FanBasis`,
  },

  // ── EMAIL — Objection Handles ─────────────────────────────────────
  {
    id: "email-obj-timing",
    label: "Not the Right Time",
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
    label: "Too Expensive",
    category: "email",
    stages: ["Qualifying", "Call Offered"],
    subject: "the math usually flips fast",
    text: `Hey [First Name],

Fair pushback on cost.

Here's the quick math: if you're doing $10k/mo, a 38% lift from BNPL is $3,800 extra monthly. FanBasis pays for itself in the first few days.

Happy to share a calculator specific to your numbers — no call, just a quick breakdown. Want it?

— Felipe`,
  },

  // ── EMAIL — Re-engagement ─────────────────────────────────────────
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

  // ── EMAIL — DM → Email Transition ─────────────────────────────────
  {
    id: "email-from-dm",
    label: "DM → Email Transition",
    category: "email",
    stages: ["Qualifying", "Call Offered"],
    subject: "sending this over from our DM",
    text: `Hey [First Name],

As promised — FanBasis in one line: BNPL checkout that recovers 38% of declined transactions, $1B+ GMV across 20k+ sellers.

I'll drop a calendar link below — happy to find a time that works:
[CALENDAR LINK]

Or just reply here and we'll sort it.

— Felipe`,
  },
];

export const CATEGORY_LABELS: Record<Script["category"], string> = {
  opener: "Openers",
  followup: "Follow-Ups",
  qualification: "Qualification",
  objection: "Objections",
  pitch: "Pitch & Book",
  email: "Email Templates",
};

export const CATEGORY_ORDER: Script["category"][] = [
  "opener", "followup", "qualification", "objection", "pitch", "email",
];

export function scriptsForStage(stage: string): Script[] {
  return SCRIPTS.filter((s) => s.stages.includes(stage));
}
