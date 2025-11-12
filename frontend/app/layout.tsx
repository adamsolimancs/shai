import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { auth, signOut } from "@/auth";
import "./globals.css";
import ShinyText from "@/components/ShinyText";
import HeaderNavCluster, { HeaderSearchBar } from "@/components/HeaderNavCluster";

export const metadata: Metadata = {
  title: "ShAI - NBA Scores, Stats, and Analysis powered by AI",
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
          <SiteFooter />
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
      <div className="relative mx-auto w-full max-w-7xl px-6 pb-4 pt-2">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col items-center gap-4 md:flex-row md:items-center md:gap-6">
            <Link href="/" className="flex shrink-0 items-center gap-3">
              <Image
                src="/aiball.png"
                alt="AI Ball logo"
                width={48}
                height={48}
                priority
                className="h-12 w-12 rounded-full border border-[color:var(--color-app-border)] bg-[#f7f0e8] object-contain p-px shadow-sm"
              />
              <span className="text-lg font-bold tracking-[0.10em] text-[var(--color-app-foreground)] md:text-xl">ShAI</span>
            </Link>
            <div className="flex w-full justify-center md:flex-1">
              <HeaderNavCluster />
            </div>
            <div className="flex w-full items-center justify-center md:w-auto md:justify-end">
              {user ? (
                <div className="surface-card--soft flex items-center gap-2 rounded-full px-3 py-1.5 text-xs md:gap-3 md:px-4 md:py-2 md:text-sm">
                  <span className="font-medium text-[var(--color-app-foreground-muted)]">Hi, {user.name ?? "there"}!</span>
                  <form
                    action={async () => {
                      "use server";
                      await signOut();
                    }}
                  >
                    <button
                      type="submit"
                      className="rounded-full border border-[color:var(--color-app-border)] px-3 py-1 text-[0.65rem] font-medium text-[color:var(--color-app-foreground-muted)] transition hover:border-[color:var(--color-app-border-strong)] hover:text-[var(--color-app-foreground)] md:text-xs"
                    >
                      Logout
                    </button>
                  </form>
                </div>
              ) : (
                <Link
                  className="group relative inline-flex items-center justify-center overflow-hidden rounded-full border border-[color:var(--color-app-border)] bg-[var(--color-app-surface-soft)] px-4 py-1.5 text-xs font-semibold text-[var(--color-app-foreground)] transition hover:border-[color:var(--color-app-border-strong)] md:px-5 md:py-2 md:text-sm"
                  href="/signin"
                >
                  <span className="absolute inset-0 scale-0 rounded-full bg-[var(--color-app-primary-soft)] transition-transform duration-300 group-hover:scale-100" />
                  <ShinyText
                    text="Sign In"
                    disabled={false}
                    speed={6}
                    className="relative"
                  />
                </Link>
              )}
            </div>
          </div>
          <HeaderSearchBar />
        </div>
      </div>
    </header>
  );
};

const SiteFooter = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-[color:var(--color-app-border)] bg-[var(--color-app-surface-elevated)]">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="flex flex-col gap-6 text-[color:var(--color-app-foreground-muted)] md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-lg font-semibold text-[var(--color-app-foreground)]">ShAI</p>
            <p className="text-sm">Real-time NBA scores, stats, and AI-powered insights, powered by nba_api.</p>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
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
          </div>
        </div>
        <div className="mt-8 flex flex-col gap-3 text-xs text-[color:var(--color-app-foreground-muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>© {currentYear} ShAI. All rights reserved.</p>
          <p>This project is not affiliated with, endorsed by, or associated with the National Basketball Association
            nor Shai Gilgeous-Alexander.
          </p>
        </div>
      </div>
    </footer>
  );
};
