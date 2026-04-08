import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import {
  hasSupabasePasswordConfigured,
  verifySupabasePasswordUser,
} from "@/lib/supabaseAuth";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const AUTH_SECRET = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

if (!AUTH_SECRET) {
  throw new Error("Missing AUTH_SECRET or NEXTAUTH_SECRET for NextAuth configuration.");
}

export const hasGoogleOAuthConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

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
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = typeof credentials.email === "string" ? credentials.email : "";
        const password = typeof credentials.password === "string" ? credentials.password : "";
        if (!email || !password) {
          return null;
        }

        try {
          const user = await verifySupabasePasswordUser(email, password);
          return {
            id: user.id,
            email: user.email,
            name: user.name,
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
} = NextAuth({
  secret: AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt" },
  providers,
});
