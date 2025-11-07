import Link from "next/link";
import type { Metadata } from "next";
import { auth, signOut } from "@/auth";
import "./globals.css";
import ShinyText from "@/components/ShinyText";

export const metadata: Metadata = {
  title: "NBAi - NBA Scores, Stats, and Analysis powered by AI",
  description: "Real-time intelligence for NBA teams, players, and trends.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <main className="app-shell">
          <SiteHeader />
          <div className="mx-auto max-w-6xl px-6 pb-16 pt-12 md:pb-24">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}

const SiteHeader = async () => {
  const session = await auth();
  const user = session?.user;

  return (
    <header className="sticky top-0 z-20 border-b border-[color:var(--color-app-border)] bg-[var(--color-app-surface-elevated)] backdrop-blur-md">
      <div className="relative mx-auto flex w-full max-w-7xl items-center justify-between gap-6 px-6 py-4">
        <Link href="/" className="flex shrink-0 items-center gap-3">
          <span className="text-lg font-bold tracking-[0.15em] text-[var(--color-app-foreground)] md:text-xl">NBAi</span>
        </Link>
        <nav className="pointer-events-auto absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 text-sm text-[color:var(--color-app-foreground-muted)] md:flex">
          <Link href="/teams" className="transition hover:text-[var(--color-app-foreground)]">
            Teams
          </Link>
          <Link href="/players" className="transition hover:text-[var(--color-app-foreground)]">
            Players
          </Link>
          <Link href="/scores" className="transition hover:text-[var(--color-app-foreground)]">
            Scores
          </Link>
          <Link href="/news" className="transition hover:text-[var(--color-app-foreground)]">
            News
          </Link>
        </nav>
        {user ? (
          <div className="surface-card--soft flex items-center gap-3 rounded-full px-4 py-2">
            <span className="text-sm font-medium text-[var(--color-app-foreground-muted)]">Hi, {user.name ?? "there"}!</span>
            <form
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <button
                type="submit"
                className="rounded-full border border-[color:var(--color-app-border)] px-3 py-1 text-xs font-medium text-[color:var(--color-app-foreground-muted)] transition hover:border-[color:var(--color-app-border-strong)] hover:text-[var(--color-app-foreground)]"
              >
                Logout
              </button>
            </form>
          </div>
        ) : (
          <Link
            className="group relative inline-flex items-center justify-center overflow-hidden rounded-full border border-[color:var(--color-app-border)] bg-[var(--color-app-surface-soft)] px-5 py-2 text-sm font-semibold text-[var(--color-app-foreground)] transition hover:border-[color:var(--color-app-border-strong)]"
            href="/signin"
          >
            <span className="absolute inset-0 scale-0 rounded-full bg-[var(--color-app-primary-soft)] transition-transform duration-300 group-hover:scale-100" />
            <ShinyText
              text="Sign In"
              disabled={false}
              speed={6}
              className='relative'
            />
          </Link>
        )}
      </div>
    </header>
  );
};
