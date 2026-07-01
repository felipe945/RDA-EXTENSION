import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { supabaseServer } from "@/lib/supabase";

// Extend NextAuth types
declare module "next-auth" {
  interface Session {
    access_token?: string;
    error?: string;
    userId?: string;
    orgId?: string;
    role?: "owner" | "admin" | "rep";
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    error?: string;
    userId?: string;
    orgId?: string;
    role?: "owner" | "admin" | "rep";
  }
}

async function refreshAccessToken(token: import("next-auth/jwt").JWT) {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type:    "refresh_token",
        refresh_token: token.refresh_token!,
      }),
    });
    const refreshed = await res.json() as Record<string, unknown>;
    if (!res.ok) throw refreshed;
    return {
      ...token,
      access_token: refreshed.access_token as string,
      expires_at:   Math.floor(Date.now() / 1000) + (refreshed.expires_in as number),
      refresh_token: (refreshed.refresh_token as string) ?? token.refresh_token,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const authOptions: NextAuthOptions = {
  pages: { signIn: "/login" },
  providers: [
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:       "openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
          access_type: "offline",
          prompt:      "consent",
        },
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    // Invite-only gate. An email may sign in if it already has a users row
    // (seeded owner or previously-accepted invite) or a live, unaccepted invite.
    async signIn({ user }) {
      if (!user.email) return false;
      const db = supabaseServer();

      const { data: existingUser } = await db
        .from("users").select("id").eq("email", user.email).maybeSingle();
      if (existingUser) return true;

      const { data: invite } = await db
        .from("invites").select("*")
        .eq("email", user.email)
        .is("accepted_at", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (!invite) return false; // not seeded, not invited — block sign-in

      const { data: newUser } = await db
        .from("users").insert({ email: user.email, name: user.name }).select("id").single();
      await db.from("memberships").insert({
        org_id: invite.org_id, user_id: newUser!.id, role: invite.role,
      });
      await db.from("invites").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id);
      return true;
    },
    async jwt({ token, account }) {
      // First sign-in — store Google tokens
      if (account) {
        token = {
          ...token,
          access_token:  account.access_token,
          refresh_token: account.refresh_token,
          expires_at:    account.expires_at,
        };
      }

      // Attach org identity once. Runs independently of the Google token lifecycle;
      // refreshAccessToken() spreads `token`, so userId/orgId/role survive refreshes.
      if (!token.userId && token.email) {
        const db = supabaseServer();
        const { data: u } = await db
          .from("users").select("id").eq("email", token.email as string).maybeSingle();
        if (u) {
          token.userId = u.id;
          const { data: m } = await db
            .from("memberships").select("org_id, role").eq("user_id", u.id).maybeSingle();
          if (m) { token.orgId = m.org_id; token.role = m.role as "owner" | "admin" | "rep"; }
        }
      }

      // Token still valid
      if (token.expires_at && Date.now() < token.expires_at * 1000) {
        return token;
      }
      // Expired — refresh
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.access_token = token.access_token;
      session.error        = token.error;
      session.userId       = token.userId;
      session.orgId        = token.orgId;
      session.role         = token.role;
      return session;
    },
  },
};
