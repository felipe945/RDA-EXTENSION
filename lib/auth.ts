import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

// Extend NextAuth types
declare module "next-auth" {
  interface Session {
    access_token?: string;
    error?: string;
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    error?: string;
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
    async jwt({ token, account }) {
      // First sign-in — store tokens
      if (account) {
        return {
          ...token,
          access_token:  account.access_token,
          refresh_token: account.refresh_token,
          expires_at:    account.expires_at,
        };
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
      return session;
    },
  },
};
