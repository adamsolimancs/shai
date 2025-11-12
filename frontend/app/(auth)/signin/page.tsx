import Link from "next/link";

import { auth, signIn, hasGoogleOAuthConfigured } from "@/auth";

export default async function SignInPage() {
  const session = await auth();

  const googleSignIn = async () => {
    "use server";
    await signIn("google", { redirectTo: "/" });
  };

  return (
    <div className="space-y-8 text-[var(--color-app-foreground)]">
      <div>
        <p className="text-xs uppercase tracking-[0.5em] text-[var(--color-app-primary)]/80">ShAI access</p>
        <h1 className="mt-3 text-3xl font-semibold">Sign in to your locker room</h1>
        <p className="mt-2 text-sm text-[color:var(--color-app-foreground-muted)]">
          Use your Google account to sync watchlists, custom dashboards, and nightly alerts across devices.
        </p>
      </div>

      {session?.user ? (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-100">
          Signed in as <span className="font-semibold">{session.user.email ?? session.user.name}</span>.{" "}
          <Link href="/(auth)/logout" className="underline">
            Manage session
          </Link>
          .
        </div>
      ) : (
        <div className="space-y-3">
          <form action={googleSignIn}>
            <button
              type="submit"
              className="btn-primary flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-3 text-sm font-semibold"
              disabled={!hasGoogleOAuthConfigured}
            >
              <GoogleGlyph />
              Continue with Google
            </button>
          </form>
          {!hasGoogleOAuthConfigured && (
            <p className="text-xs text-amber-300">
              Google OAuth is not configured. Set <code className="text-[11px]">GOOGLE_CLIENT_ID</code> and{" "}
              <code className="text-[11px]">GOOGLE_CLIENT_SECRET</code> in <code className="text-[11px]">.env.local</code>.
            </p>
          )}
          <div className="relative py-4">
            <span className="absolute inset-x-0 top-1/2 h-px bg-[var(--color-app-border)]" aria-hidden="true" />
            <span className="relative mx-auto block w-max bg-[var(--color-app-background)] px-3 text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)]">
              or
            </span>
          </div>
          <form className="surface-card--soft space-y-4 rounded-2xl p-5">
            <div className="space-y-2">
              <label htmlFor="email" className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)]">
                Username / Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="jalen-brunson@shai.app"
                className="w-full rounded-xl border border-[color:var(--color-app-border)] bg-[var(--color-app-surface)] px-4 py-2.5 text-sm text-[var(--color-app-foreground)] placeholder:text-[color:var(--color-app-foreground-muted)] focus:border-[color:var(--color-app-primary)] focus:outline-none"
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)]">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                className="w-full rounded-xl border border-[color:var(--color-app-border)] bg-[var(--color-app-surface)] px-4 py-2.5 text-sm text-[var(--color-app-foreground)] placeholder:text-[color:var(--color-app-foreground-muted)] focus:border-[color:var(--color-app-primary)] focus:outline-none"
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              className="btn-primary w-full rounded-2xl px-4 py-2.5 text-sm font-semibold"
            >
              Continue with email
            </button>
          </form>
        </div>
      )}

      <p className="text-sm text-[color:var(--color-app-foreground-muted)]">
        New to ShAI?{" "}
        <Link href="/signup" className="text-[var(--color-app-primary)] hover:text-[var(--color-app-primary-hover)]">
          Create an account
        </Link>
        .
      </p>
    </div>
  );
}

const GoogleGlyph = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M12 10.8v3.7h5.2c-.2 1.2-.9 2.2-2 2.9l3.2 2.5c1.9-1.7 3-4.1 3-7 0-.7-.1-1.4-.2-2H12z"
    />
    <path fill="#34A853" d="M5.3 14.3l-.8.6-2.6 2.1C3.8 20 7.6 22 12 22c2.4 0 4.5-.8 6-2.1l-3.2-2.5c-.9.6-2.1 1-2.8 1-2.3 0-4.3-1.5-5-3.6z" />
    <path fill="#4A90E2" d="M3.9 8.9 1.3 6.8C.5 8.3.1 9.9.1 11.6c0 1.7.4 3.3 1.2 4.8l3.9-3.1c-.2-.6-.3-1.2-.3-1.9 0-.6.1-1.3.3-1.9z" />
    <path fill="#FBBC05" d="M12 4.7c1.3 0 2.4.4 3.2 1.1l2.4-2.4C16.5 1.8 14.4 1 12 1 7.6 1 3.8 3 1.3 6.8l3.9 3.1c.7-2.2 2.7-3.7 4.8-3.7z" />
  </svg>
);
