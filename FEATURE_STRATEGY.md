# FanBasis Sales OS — Feature Strategy

**Decided:** 2026-07-01 · **Status:** strategy locked, build not started (awaiting go)
**Visual version:** https://claude.ai/code/artifact/00bc7eb3-4c93-428d-aa5b-a3530783bda5

---

## The thesis

Stop building a general-purpose CRM. Build the **outreach-message machine**.

The tool drifted into a platform — CSM mode, SMS, briefings, auto-balancing. The actual job is **one loop: turn an Instagram prospect into a booked call**. And the #1 pain is **nailing the message**. Everything either serves that loop or gets cut.

## Locked decisions

| Question | Decision |
|----------|----------|
| Scope | **FanBasis outbound sales only** — cut/hide Servedia CSM mode |
| Users | **Small team** — reps working leads today |
| Channels | **Instagram DMs (primary), Email, LinkedIn** — SMS cut |
| #1 priority | **Nail the outreach message** (the north star) |

---

## The core loop — the only 5 things that must work well

```
Capture  →  Research  →  MESSAGE  →  Follow-up  →  Reply  →  (repeat)
 harden      keep        HERO         keep         harden
```

| # | Feature | Status | The bar it must clear | Powered by |
|---|---------|--------|------------------------|------------|
| 1 | **IG Capture** | Harden | One-click save, under 2s, never loses a save (retry queue), works on every profile layout | `chrome-extension` · `/api/ig-events` |
| 2 | **Auto-Research** | Keep | Fit score + GMV + niche + "already a customer?" in <60s, never blank, feeds the message engine | `/api/ai/research-lead` · Salesforce cross-ref |
| 3 | **Outreach Message Engine** | **HERO — invest** | Open a lead and the opener is already there, sounds hand-written, one-tap copy, objection follow-ups one tap away | `/api/opener` · `ScriptsVault` · fanbasis-outbound/sales skills |
| 4 | **Follow-up Tracking** | Keep | Open the app, instantly see who to touch today; nothing warm slips | Dashboard buckets · `due_at` |
| 5 | **Reply Detection** | Harden | Reply surfaces within minutes and pushes the lead to the top. **IG + email only** | `/api/messages` · inbox |

---

## The one feature worth obsessing over

**Fuse research → message.** Today they're two separate acts: the tool scores the lead, then you go write the DM. Instead, the moment research completes, a real opener should already be drafted onto the lead — built from what makes *that* person worth reaching out to, in your voice, with a clear next step.

```
their bio + niche  +  FanBasis voice & CTA rules  +  the right play  =  a DM you'd actually send
```

Then back it with a **tight scripts vault**: openers + the 4–5 objections you actually hear + the booking ask, all one-tap copy.

> Your pain isn't tracking — it's the blank DM box. **Kill the blank box.** That is the product; everything else is in service of it.

---

## Keep quietly (don't gold-plate)

- Lead list · stages · search — works, leave it alone
- Email compose & send — real channel, keep it simple (send + track)
- LinkedIn tracking — used, but secondary to IG; don't let it pull focus
- Salesforce "is-customer" check — invisible but high-value (stops you pitching customers)
- Bulk CSV import — just shipped; one-off lists, not a daily driver
- Team assignment · invites · my-vs-team — real for a small team (who owns a lead, who answers a reply); keep lightweight

## Cut or defer (the complexity you felt)

| Feature | Verdict | Why |
|---------|---------|-----|
| CSM mode (Servedia) | **Cut** | A whole second app bolted on. Sales-only now — hide it, reclaim the focus. |
| SMS / SendBlue | **Cut** | Not a channel you use. Dead code + missing keys today anyway. |
| Round-robin auto-balancing | Defer | Manual assignment is plenty for a small team. |
| Daily briefing → Slack · nightly scoring | Defer | Scheduled jobs that don't run in prod. Nice-to-have, not core. |

---

## Proposed build order (not started)

1. **Hide the noise** — turn off CSM mode + SMS in the UI. Instant simplification, nothing important lost.
2. **Fuse research → message** — auto-draft the opener onto the lead when research completes. Highest leverage on the #1 pain.
3. **Tighten the scripts vault** — real openers + real objections + the booking ask, one-tap copy.
4. **Harden capture & replies** — bulletproof extension save; reliable IG + email reply detection.

*Related: `PRODUCTION_GAPS.md` (#1 API auth already fixed; #2 Inngest still blocks the research→message auto-draft drain).*
