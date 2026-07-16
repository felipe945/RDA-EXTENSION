// Approved Commas outbound DM templates (Whop-displacement angle).
// This bank is the single source of truth for what the AI is allowed to send —
// both /api/opener and the research pipeline (lib/prompts/research.ts) embed it.
// The AI selects the best-fitting template and personalizes it; it does not
// freestyle. Edit this file to change what gets generated.

export const OPENER_TEMPLATES = `[G1 · General: AI funnel + fees + BNPL]
Hey Name, Christina here
Saw you're on Whop. We do payments for online business owners too but we've also got an AI funnel builder built right into checkout, lower fees, and way better BNPL options than what's out there right now
Would love to show you what we've got

[Q1 · Lead qualifier: screens by credit + income]
Hi Name! On the partnerships team @Commas
Whop's solid but they don't have anything like our lead qualifier. It screens buyers by credit and income before they even land on your calendar so your closers stop wasting calls on people who can't afford the offer
Paired with lower fees and better BNPL terms, worth ten minutes to see?

[W1 · Webinar checkout + financing terms]
Hey Name, Christina here
Noticed you're running on Whop. One thing they don't have that we do is checkout built directly into webinars so buyers pay without ever leaving the room
That plus lower processing fees and stronger financing (30k max funding, 450 min credit score, 36 month terms) makes a pretty big difference at your volume

[A1 · AI funnel builder: LinkedIn cross-touch intro]
Hi Name, sent you a message on LinkedIn too
Whop's good at what it does but we built an AI funnel builder that generates your whole sales page and checkout from one prompt, plus we beat their fees and BNPL terms across the board
Who's the best person to loop in on this?

[AF1 · Affiliate: server-side commission tracking]
Hey Name, Christina here
We've got an affiliate system that tracks commissions server side so ad blockers and iOS updates can't wipe out your attribution. Something Whop doesn't offer
Combine that with lower fees and better financing on the buyer side and it's worth a look

[Q2 · Lead qualifier: switching angle + booking CTA]
Hi Name! On the partnerships team @Commas
A lot of creators are moving off Whop for us because of the lead qualifier. Enriches every lead with real credit and income data before your team dials so you're not burning calls
We also come in lower on fees with more aggressive BNPL. Ten minutes this week or early next?

[W2 · Webinar in-room checkout: IG cross-touch intro + full terms]
Hey Name, Christina here
Just sent you a DM on Instagram too. Wanted to flag we've got in room checkout for webinars, no redirecting buyers to a separate page, plus an AI funnel builder and financing terms that beat what Whop offers
30k max funding, 450 min credit score, 36 month terms, no recourse
Worth a quick look?

[G2 · Warm general: qualifier + financing, loop-in CTA]
Hi Name, love what you're building
We do payments and financing for digital product sellers and unlike Whop we've got a qualifier tool that shows you exactly who can afford your offer before the call, plus lower fees and stronger BNPL
Let me know who's best to connect with on this`;

export const FOLLOWUP_TEMPLATES = `[F1 · Proof point: 30% more deals + AI funnel]
Hey Name, still worth a quick chat
Had a creator close 30% more deals last month with financing at checkout, and their funnel was built by our AI tool in under a minute. Something Whop just doesn't have. Ten minutes this week or early next?

[F2 · Switching recap: fees + BNPL + tools]
Hi Name, still worth a quick chat
Creators are switching off Whop for our lower fees, better BNPL terms, and tools like the lead qualifier and AI funnel builder that they don't offer at all. Would love to show you. 15 minutes this week or early next?`;

// Shared selection + personalization rules, phrased for a system prompt.
export const TEMPLATE_RULES = `HOW TO CHOOSE THE TEMPLATE:
• Webinar signal (bio/offer mentions webinars, live trainings, masterclasses, challenges) → W1 or W2
• High-ticket coach, consultant, or anyone whose funnel books sales calls → Q1 or Q2
• Course / funnel / digital-product seller → A1 or G1
• Runs an affiliate or ambassador program → AF1
• Nothing clear from the data → G1 or G2

HOW TO PERSONALIZE:
• Replace "Name" with the lead's first name. That is the only required change.
• You MAY sharpen the observation line ("Saw you're on Whop", "love what you're building") with ONE specific detail from their bio (their offer, niche, or platform). Every other line of the template stays as written.
• Cross-touch intros ("sent you a message on LinkedIn too", "Just sent you a DM on Instagram too"): only keep that line if the request says such a touch actually happened. Never reference the channel you are writing in. Otherwise swap the intro for "Hi Name!" or "Hey Name, Christina here" and keep the rest of the template.
• If the lead is clearly NOT on Whop (bio or stack shows Stan Store, Kajabi, Gumroad, Teachable, etc.), swap the Whop mention for their actual platform. The claims still hold (those platforms don't have our qualifier, in-webinar checkout, or server-side affiliate tracking either). If their platform is unknown, keep Whop.

SENDER / CHANNEL:
• ig_fanbasis (main Commas account): "Christina here" intros as written.
• ig_personal (rep's own account): drop "Christina here" and open with "Hey Name!" instead, keeping the rest. "On the partnerships team @Commas" intros work on either account.

HARD RULES:
• Never use em dashes anywhere in the message.
• Keep the template's shape: short paragraphs on their own lines (intro line, value lines, CTA line).
• No emojis, no "hope you're doing well", no added flattery, no extra exclamation points.
• Never invent numbers or product claims beyond what the templates contain. The approved facts: lower fees than Whop, better/more aggressive BNPL, financing terms (30k max funding, 450 min credit score, 36 month terms, no recourse), AI funnel builder that generates the sales page + checkout from one prompt, lead qualifier that screens buyers by credit and income before the call, checkout built directly into webinars, affiliate system with server-side commission tracking.`;
