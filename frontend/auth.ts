import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import type { Session } from "next-auth";

import { syncUserAccount } from "@/lib/userAccountsApi";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const AUTH_SECRET = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

if (!AUTH_SECRET) {
  throw new Error("Missing AUTH_SECRET or NEXTAUTH_SECRET for NextAuth configuration.");
}

export const hasGoogleOAuthConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

const sessionUserUpdateSchema = (value: unknown): Partial<Session["user"]> => {
  if (!value || typeof value !== "object" || !("user" in value)) {
    return {};
  }

  const user = value.user;
  return user && typeof user === "object" ? (user as Partial<Session["user"]>) : {};
};

const providers = [];

if (hasGoogleOAuthConfigured) {
  providers.push(
    Google({
      clientId: GOOGLE_CLIENT_ID!,
      clientSecret: GOOGLE_CLIENT_SECRET!,
    }),
  );
} else {
  console.warn(
    "[ShAI] Google OAuth environment variables are missing. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable Google auth.",
  );
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
  unstable_update,
} = NextAuth({
  secret: AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt" },
  providers,
  callbacks: {
    async jwt({ token, user, account, profile, trigger, session }) {
      if (user && account) {
        const authUserId = `${account.provider}:${account.providerAccountId}`;
        const email = user.email ?? (typeof token.email === "string" ? token.email : "");
        let syncedAccount = null;

        try {
          syncedAccount = await syncUserAccount({
            auth_user_id: authUserId,
            email,
            email_verified: profile?.email_verified === true,
            name: user.name ?? null,
          });
        } catch (error) {
          console.error("[ShAI] user account sync failed", {
            provider: account.provider,
            authUserId,
            email: email || null,
            error,
          });
        }

        token.sub = authUserId;
        token.name = syncedAccount?.name ?? user.name ?? null;
        token.email = syncedAccount?.email ?? email;
        token.picture = user.image ?? token.picture;
        token.username = syncedAccount?.username ?? null;
        token.provider = account.provider;
      }

      if (trigger === "update") {
        const updatedUser = sessionUserUpdateSchema(session);

        if (typeof updatedUser.name === "string") {
          token.name = updatedUser.name.trim();
        }

        if ("username" in updatedUser) {
          const normalizedUsername =
            typeof updatedUser.username === "string" && updatedUser.username.trim()
              ? updatedUser.username.trim().toLowerCase()
              : null;
          token.username = normalizedUsername;
        }
      }

      return token;
    },
    async session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: token.sub ?? "",
          name: typeof token.name === "string" ? token.name : session.user?.name,
          email: typeof token.email === "string" ? token.email : session.user?.email,
          image: typeof token.picture === "string" ? token.picture : session.user?.image,
          username: typeof token.username === "string" ? token.username : null,
          provider: typeof token.provider === "string" ? token.provider : null,
        },
      };
    },
  },
});
