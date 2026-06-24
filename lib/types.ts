// Shared domain types — import from '@/lib/types' in API routes and lib code
// For component usage, use the Lead type from @/hooks/useLeads (superset with normalization)

export type LeadStage =
  | "New" | "Warming" | "DM Sent" | "Qualifying" | "Call Offered" | "Booked" | "Closed" | "DQ"
  | "Active" | "At Risk" | "Churned";

export type LeadMode = "sales" | "csm";
export type LeadSource = "IG" | "LinkedIn" | "SMS" | "Email" | "Manual";

// "error" matches research-lead route; "none" is the DB default
export type ResearchStatus = "none" | "pending" | "complete" | "error";

export type IgEvent = {
  type: string;
  postUrl: string | null;
  ts: string;
};

export type Lead = {
  id: string;
  created_at: string;
  updated_at: string;
  name: string | null;
  ig_username: string | null;
  ig_user_id: string | null;
  ig_profile_url: string | null; // column name in DB (used by research-lead route)
  bio: string | null;
  follower_count: number | null;
  linkedin_url: string | null;
  phone: string | null;
  email: string | null;
  stage: LeadStage;
  source: LeadSource | null;
  mode: LeadMode;
  due_at: string | null;
  last_contact_at: string | null;
  ig_events: IgEvent[];
  notes: string | null;
  tags: string[];
  score: number;
  research_status: ResearchStatus;
  research_cache: Record<string, unknown> | null; // shape defined by lib/prompts/research.ts
};

// channel values must be lowercase (matched by inbox/page.tsx)
export type MessageChannel = "ig" | "sms" | "email" | "linkedin";
export type MessageDirection = "inbound" | "outbound";

export type Message = {
  id: string;
  lead_id: string | null;
  created_at: string;
  direction: MessageDirection;
  channel: MessageChannel;
  body: string | null;
  external_id: string | null;
  from_address: string | null;
  to_address: string | null;
  raw: Record<string, unknown> | null;
  read: boolean;
};
