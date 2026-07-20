// Pulse classifier prompts — judges a client conversation like a top CSM.
// ⚑ client_notes is load-bearing for accuracy: it's how the model knows who
// the client is, what's in flight, and what "delivered" looks like. The UI
// nags Felipe to fill it in for exactly this reason.
import type Anthropic from "@anthropic-ai/sdk";

export interface PulseClassification {
  needs_reply: boolean;
  waiting_on: "you" | "them" | "none";
  open_commitment: string | null;
  urgency: "low" | "medium" | "high";
  summary: string;
  suggested_reply: string;
}

export const PULSE_TOOL_SCHEMA: Anthropic.Tool["input_schema"] = {
  type: "object",
  properties: {
    needs_reply: {
      type: "boolean",
      description:
        "true if the latest client message expects an answer from Felipe. false ONLY for clear closers with nothing pending.",
    },
    waiting_on: {
      type: "string",
      enum: ["you", "them", "none"],
      description:
        "Who the ball is with. 'you' whenever Felipe made a promise/commitment not yet visibly delivered in the thread — even if he replied last.",
    },
    open_commitment: {
      type: ["string", "null"],
      description:
        "If waiting_on is 'you' because of a promise: quote or tightly paraphrase what Felipe committed to. Otherwise null.",
    },
    urgency: { type: "string", enum: ["low", "medium", "high"] },
    summary: {
      type: "string",
      description: "≤120 chars, plain language: where this conversation stands right now.",
    },
    suggested_reply: {
      type: "string",
      description:
        "A reply Felipe could paste. His voice: casual professional, 1-3 sentences, no em dashes, no corporate filler, ends with a concrete next step or question when appropriate.",
    },
  },
  required: ["needs_reply", "waiting_on", "open_commitment", "urgency", "summary", "suggested_reply"],
};

export const PULSE_CLASSIFY_SYSTEM = `You are the triage brain of a private, read-only account-management watchdog for Felipe, who manages client accounts at Commas (a payments platform for creators and coaches, formerly FanBasis). You judge client conversations like a top customer success manager whose one job is making sure no client is ever left hanging.

Rules:
- needs_reply=false ONLY for clear closers ("thanks!", "sounds good", "🙏", an emoji react-style sign-off) with nothing pending underneath. When uncertain, needs_reply=true — a false alarm costs Felipe a glance; a missed one costs a client.
- waiting_on="you" whenever Felipe made a promise or commitment that is not yet visibly delivered in the thread ("will do", "I'll send it tomorrow", "let me check with the team") — even if his message is the most recent one. Quote the promise in open_commitment.
- waiting_on="them" when Felipe asked something and the client hasn't answered.
- Judge from the CLIENT CONTEXT notes when present — they tell you what's in flight and what "done" looks like.
- summary: plain, concrete, ≤120 characters. No fluff.
- suggested_reply is copy-paste material ONLY (nothing sends it). Felipe's voice: casual professional, warm but direct, 1-3 sentences, no em dashes, no corporate filler.`;

export interface PulseClassifyInput {
  clientName: string | null;
  clientNotes: string | null;
  channel: string;
  messages: {
    author: string | null;
    direction: "in" | "out";
    body: string | null;
    agoHours: number;
  }[];
}

export function buildPulseClassifyPrompt(input: PulseClassifyInput): string {
  const lines = input.messages.map((m) => {
    const who = m.direction === "out" ? "FELIPE" : (m.author ?? "CLIENT");
    const ago =
      m.agoHours < 1
        ? "just now"
        : m.agoHours < 48
          ? `${Math.round(m.agoHours)}h ago`
          : `${Math.round(m.agoHours / 24)}d ago`;
    return `[${ago}] ${who}: ${m.body ?? "[no text]"}`;
  });

  return [
    `CHANNEL: ${input.channel}`,
    `CLIENT: ${input.clientName ?? "(unnamed)"}`,
    `CLIENT CONTEXT (Felipe's notes): ${input.clientNotes?.trim() || "(none — judge from the thread alone)"}`,
    ``,
    `CONVERSATION (oldest first, ${input.messages.length} most recent messages):`,
    ...lines,
    ``,
    `Classify this conversation now.`,
  ].join("\n");
}
