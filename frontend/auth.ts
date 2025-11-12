import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

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
