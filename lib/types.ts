// Shared domain types — import from '@/lib/types' in API routes and lib code
// For component usage, use the Lead type from @/hooks/useLeads (superset with normalization)
import type { Stage } from "@/lib/stages";

// Canonical sales stages come from lib/stages.ts (single source of truth).
// "Blocked" is retired (0 leads live). CSM stages remain here as legacy values
// tolerated on existing rows until migration 019 retires them.
export type LeadStage = Stage | "Active" | "At Risk" | "Churned";

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
  ig_profile_url: string | null;
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
  research_cache: Record<string, unknown> | null;
  // Salesforce cross-reference
  sf_account_id: string | null;
  sf_account_name: string | null;
  sf_status: "customer" | "inactive" | "prospect" | "none";
  sf_confidence_score: number;
  sf_match_reasons: string[];
  sf_last_checked: string | null;
  // Fields from migrations 003 / 004 that were missing from type
  twitter_username: string | null;
  external_url: string | null;
  source_account: string | null;   // which IG handle hit Save (set by Chrome extension)
  // Outreach tracking
  outreach_channels: Record<string, unknown>;
  outreach_log: Record<string, unknown>[];
  // Action timestamps (set by extension Outreach tab)
  dm_sent_at: string | null;
  dq_at: string | null;
  // Team columns (migration 011_teams.sql)
  assigned_to: string | null;   // user_id of the rep currently working the lead
  owner_id: string | null;      // user_id of whoever sourced it
  org_id: string | null;        // org the lead belongs to
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
  sent_from_handle: string | null;  // which IG/email account sent this (migration 007)
};
