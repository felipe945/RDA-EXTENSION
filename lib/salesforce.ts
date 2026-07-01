// Salesforce account lookup — confidence-scored fuzzy matching
// Credentials via env vars: SF_USERNAME, SF_PASSWORD, SF_TOKEN, SF_INSTANCE_URL
// Read-only. No connected app needed — uses username+password SOAP auth.

const SF_API_VERSION = "v58.0";

// ── Session cache (survives Vercel warm starts) ──────────────────────────────

let sfSession: { sessionId: string; instanceUrl: string; expiresAt: number } | null = null;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function getSfSession(): Promise<{ sessionId: string; instanceUrl: string }> {
  if (sfSession && sfSession.expiresAt > Date.now()) return sfSession;

  const username  = process.env.SF_USERNAME;
  const password  = process.env.SF_PASSWORD ?? "";
  const token     = process.env.SF_TOKEN ?? "";
  const loginUrl  = process.env.SF_INSTANCE_URL ?? "https://login.salesforce.com";

  if (!username) throw new Error("SF_USERNAME not configured");

  const soap = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:urn="urn:partner.soap.sforce.com">
  <soapenv:Body>
    <urn:login>
      <urn:username>${escapeXml(username)}</urn:username>
      <urn:password>${escapeXml(password + token)}</urn:password>
    </urn:login>
  </soapenv:Body>
</soapenv:Envelope>`;

  const res = await fetch(`${loginUrl}/services/Soap/u/${SF_API_VERSION}`, {
    method: "POST",
    headers: { "Content-Type": "text/xml", "SOAPAction": "login" },
    body: soap,
  });

  if (!res.ok) throw new Error(`SF SOAP login failed: HTTP ${res.status}`);

  const xml = await res.text();
  const sessionIdMatch = xml.match(/<sessionId>([^<]+)<\/sessionId>/);
  const serverUrlMatch  = xml.match(/<serverUrl>([^<]+)<\/serverUrl>/);

  if (!sessionIdMatch || !serverUrlMatch) {
    const faultMatch = xml.match(/<faultstring>([^<]+)<\/faultstring>/);
    throw new Error(`SF login error: ${faultMatch?.[1] ?? "check credentials"}`);
  }

  const sessionId   = sessionIdMatch[1];
  const instanceUrl = new URL(serverUrlMatch[1]).origin;

  // SF sessions last 2 hours; cache for 90 min to be safe
  sfSession = { sessionId, instanceUrl, expiresAt: Date.now() + 90 * 60 * 1000 };
  return sfSession;
}

async function sfQuery<T>(soql: string): Promise<T[]> {
  const { sessionId, instanceUrl } = await getSfSession();
  const url = `${instanceUrl}/services/data/${SF_API_VERSION}/query/?q=${encodeURIComponent(soql)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${sessionId}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SF query failed ${res.status}: ${text.slice(0, 160)}`);
  }
  const data = (await res.json()) as { records: T[] };
  return data.records ?? [];
}

// ── Types ────────────────────────────────────────────────────────────────────

export type SfStatus = "customer" | "inactive" | "prospect" | "none";
export type SfConfidence = "high" | "medium" | "low";

export interface SfMatchResult {
  sfAccountId:       string | null;
  sfAccountName:     string | null;
  sfStatus:          SfStatus;
  sfConfidenceScore: number;           // 0–100
  sfMatchConfidence: SfConfidence | null;
  sfMatchReasons:    string[];
  sfLastChecked:     string;
  alreadyCustomer:   boolean;
}

interface SfAccount {
  Id:               string;
  Name:             string;
  Website:          string | null;
  Industry:         string | null;
  Type:             string | null;
  LastActivityDate: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extractDomain(url: string): string | null {
  try {
    const u = url.startsWith("http") ? url : `https://${url}`;
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch { return null; }
}

// ── Scoring ──────────────────────────────────────────────────────────────────
// Signals (max 100 pts):
//   Website domain exact   40
//   Name exact (norm)      35
//   Name contains          22
//   Username in name       16
//   Website partial        18
// Confidence tiers:  ≥55 = high · ≥25 = medium · ≥10 = low

function scoreCandidate(
  account: SfAccount,
  lead: { displayName?: string | null; igUsername?: string | null; externalUrl?: string | null }
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const accNorm     = norm(account.Name);
  const displayNorm = norm(lead.displayName ?? "");
  const igNorm      = norm(lead.igUsername  ?? "");

  // ── Name matching ─────────────────────────────────────────────────
  if (displayNorm.length >= 3) {
    if (accNorm === displayNorm) {
      score += 35;
      reasons.push(`Name exact: "${account.Name}"`);
    } else if (accNorm.includes(displayNorm) || displayNorm.includes(accNorm)) {
      score += 22;
      reasons.push(`Name overlap: "${account.Name}"`);
    }
  }

  // ── Handle matching — always runs, stacks on top of name score ────
  // This catches cases like @alicialyttle where name="Alicia" only scores 22
  // (partial) but handle "alicialyttle" === SF name "alicialyttle" → +28 → 50 total
  if (igNorm.length >= 4) {
    if (accNorm === igNorm) {
      score += 28;
      reasons.push(`Handle exact match: "${account.Name}"`);
    } else if (accNorm.includes(igNorm) || igNorm.includes(accNorm)) {
      score += 16;
      reasons.push(`Handle similar to name: "${account.Name}"`);
    }
  }

  // ── Website / URL matching ────────────────────────────────────────
  if (account.Website && lead.externalUrl) {
    const sfDomain   = extractDomain(account.Website);
    const leadDomain = extractDomain(lead.externalUrl);
    if (sfDomain && leadDomain) {
      if (sfDomain === leadDomain) {
        score += 40;
        reasons.push(`Website exact: ${sfDomain}`);
      } else {
        const sfSld   = sfDomain.split(".")[0];
        const leadSld = leadDomain.split(".")[0];
        if (sfSld && leadSld && sfSld.length >= 4 &&
            (sfSld.includes(leadSld) || leadSld.includes(sfSld))) {
          score += 18;
          reasons.push(`Website similar: ${sfDomain}`);
        }
      }
    }
  }

  // ── Industry hint (additive bonus, doesn't anchor confidence alone) ─
  if (account.Industry) {
    const ind = account.Industry.toLowerCase();
    const CREATOR_INDUSTRIES = ["media", "entertainment", "retail", "consumer", "technology", "ecommerce"];
    if (CREATOR_INDUSTRIES.some(k => ind.includes(k))) {
      score += 5;
      reasons.push(`Industry: ${account.Industry}`);
    }
  }

  return { score: Math.min(score, 100), reasons };
}

function toConfidence(score: number): SfConfidence | null {
  if (score >= 55) return "high";
  if (score >= 25) return "medium";
  if (score >= 10) return "low";
  return null;
}

function deriveStatus(account: SfAccount): SfStatus {
  const type = (account.Type ?? "").toLowerCase();
  if (type.includes("customer")) {
    if (account.LastActivityDate) {
      const daysSince = (Date.now() - new Date(account.LastActivityDate).getTime()) / 86_400_000;
      if (daysSince > 90) return "inactive";
    }
    return "customer";
  }
  // Present in SF but not typed as customer
  return "prospect";
}

// ── Public lookup function ───────────────────────────────────────────────────

export async function lookupLeadInSalesforce(lead: {
  displayName?: string | null;
  igUsername?:  string | null;
  externalUrl?: string | null;
}): Promise<SfMatchResult> {
  const now = new Date().toISOString();
  const empty: SfMatchResult = {
    sfAccountId: null, sfAccountName: null, sfStatus: "none",
    sfConfidenceScore: 0, sfMatchConfidence: null, sfMatchReasons: [],
    sfLastChecked: now, alreadyCustomer: false,
  };

  if (!process.env.SF_USERNAME) return empty; // credentials not set up — skip silently

  try {
    // Build SOQL with OR conditions across available signals
    const escapeSoql = (s: string) => s.replace(/'/g, "\\'");
    const conditions: string[] = [];

    const displayName = lead.displayName?.trim();
    const igUsername  = lead.igUsername?.trim();
    const domain      = lead.externalUrl ? extractDomain(lead.externalUrl) : null;

    // Use first word of display name (broader match, avoids "LLC" noise)
    if (displayName && displayName.length >= 3) {
      const firstWord = displayName.split(/\s+/)[0];
      if (firstWord.length >= 3) conditions.push(`Name LIKE '%${escapeSoql(firstWord)}%'`);
    }

    if (igUsername && igUsername.length >= 4) {
      conditions.push(`Name LIKE '%${escapeSoql(igUsername)}%'`);
    }

    if (domain) {
      const sld = domain.split(".")[0]; // second-level domain only
      if (sld.length >= 4) conditions.push(`Website LIKE '%${escapeSoql(sld)}%'`);
    }

    if (!conditions.length) return empty;

    const soql = `SELECT Id, Name, Website, Industry, Type, LastActivityDate
FROM Account
WHERE ${conditions.join(" OR ")}
LIMIT 15`;

    const accounts = await sfQuery<SfAccount>(soql);
    if (!accounts.length) return empty;

    // Score all candidates and take the best
    const scored = accounts
      .map(a => ({ account: a, ...scoreCandidate(a, lead) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];

    // Tiered confidence threshold:
    //   - Multi-word full name exact (e.g. "Brandon Carter", "Alicia Lyttle"): specific enough at 35
    //   - Everything else: require two signals combining to 50+ so first-name-only SF
    //     accounts ("Mike", "Jason") don't match every handle that contains that name
    const displayWords = (lead.displayName ?? "").trim().split(/\s+/);
    const isMultiWordExact = displayWords.length >= 2
      && best.reasons.some(r => r.startsWith("Name exact:"));
    const minScore = isMultiWordExact ? 35 : 50;

    if (best.score < minScore) return empty;

    const status     = deriveStatus(best.account);
    const confidence = toConfidence(best.score);

    return {
      sfAccountId:       best.account.Id,
      sfAccountName:     best.account.Name,
      sfStatus:          status,
      sfConfidenceScore: best.score,
      sfMatchConfidence: confidence,
      sfMatchReasons:    best.reasons,
      sfLastChecked:     now,
      alreadyCustomer:   status === "customer",
    };
  } catch (err) {
    // SF is not critical path — log and continue
    console.error("[salesforce] lookup error:", (err as Error).message);
    return empty;
  }
}
