import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import type { Session } from "next-auth";

import {
  hasSupabasePasswordConfigured,
  verifySupabasePasswordUser,
} from "@/lib/supabaseAuth";
import {
  findUserAccountByAuthUserId,
  findUserAccountByUsername,
  syncUserAccount,
} from "@/lib/userAccountsApi";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const AUTH_SECRET = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

if (!AUTH_SECRET) {
  throw new Error("Missing AUTH_SECRET or NEXTAUTH_SECRET for NextAuth configuration.");
}

export const hasGoogleOAuthConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

const normalizeIdentifier = (value: string) => value.trim().toLowerCase();

const isEmailIdentifier = (value: string) => value.includes("@");

async function resolvePasswordSignInIdentifier(identifier: string) {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  if (!normalizedIdentifier) {
    return null;
  }

  if (isEmailIdentifier(normalizedIdentifier)) {
    return normalizedIdentifier;
  }

  const account = await findUserAccountByUsername(normalizedIdentifier);
  return account?.email ?? null;
}

async function hydratePasswordUserAccount(user: {
  id: string;
  email: string;
  name: string;
  username: string | null;
}) {
  try {
    const existingAccount = await findUserAccountByAuthUserId(user.id);
    if (existingAccount) {
      return {
        ...user,
        email: existingAccount.email || user.email,
        name: existingAccount.name || user.name,
        username: existingAccount.username ?? user.username,
      };
    }

    const syncedAccount = await syncUserAccount({
      auth_user_id: user.id,
      email: user.email,
      name: user.name,
      username: user.username,
    });

    return {
      ...user,
      email: syncedAccount.email || user.email,
      name: syncedAccount.name || user.name,
      username: syncedAccount.username ?? user.username,
    };
  } catch {
    return user;
  }
}

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

if (hasSupabasePasswordConfigured) {
  providers.push(
    Credentials({
      name: "Email and Password",
      credentials: {
        identifier: { label: "Email or Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const identifier = typeof credentials.identifier === "string" ? credentials.identifier : "";
        const password = typeof credentials.password === "string" ? credentials.password : "";
        if (!identifier || !password) {
          return null;
        }

        try {
          const resolvedEmail = await resolvePasswordSignInIdentifier(identifier);
          if (!resolvedEmail) {
            return null;
          }

          const user = await verifySupabasePasswordUser(resolvedEmail, password);
          const hydratedUser = await hydratePasswordUserAccount(user);
          return {
            id: hydratedUser.id,
            email: hydratedUser.email,
            name: hydratedUser.name,
            username: hydratedUser.username,
            provider: "credentials",
          };
        } catch {
          return null;
        }
      },
    }),
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
    async jwt({ token, user, account, trigger, session }) {
      if (user) {
        let syncedAccount = null;
        const tokenEmail = typeof token.email === "string" ? token.email : "";
        const tokenName = typeof token.name === "string" ? token.name : null;
        const tokenUsername = typeof token.username === "string" ? token.username : null;

        try {
          syncedAccount = await syncUserAccount({
            auth_user_id: user.id ?? token.sub ?? "",
            email: user.email ?? tokenEmail,
            name: user.name ?? tokenName,
            username: user.username ?? tokenUsername,
          });
        } catch (error) {
          console.error("[ShAI] user account sync failed", {
            provider: account?.provider ?? user.provider ?? null,
            authUserId: user.id ?? token.sub ?? null,
            email: user.email ?? (tokenEmail || null),
            error,
          });
        }

        token.sub = syncedAccount?.auth_user_id ?? user.id ?? token.sub;
        token.name = syncedAccount?.name ?? user.name ?? tokenName;
        token.email = syncedAccount?.email ?? user.email ?? tokenEmail;
        token.picture = user.image ?? token.picture;
        token.username = syncedAccount?.username ?? user.username ?? tokenUsername;
        token.provider = user.provider ?? account?.provider ?? token.provider ?? null;
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
