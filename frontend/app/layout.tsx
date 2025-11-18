import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { Suspense } from "react";
import { auth, signOut } from "@/auth";
import "./globals.css";
import ShinyText from "@/components/ShinyText";
import HeaderNavCluster, { HeaderSearchBar } from "@/components/HeaderNavCluster";
import ThemeToggle from "@/components/ThemeToggle";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.shaistats.com"),
  title: {
    default: "ShAI – NBA Scores, Stats, and AI Insights",
    template: "%s · ShAI",
  },
  description: "Real-time NBA intelligence with AI-generated scouting reports, live scores, and advanced stats.",
  keywords: ["NBA stats", "basketball analytics", "AI scouting", "ShAI", "NBA scores", "NBA data"],
  authors: [{ name: "ShAI Team" }],
  creator: "ShAI",
  publisher: "ShAI",
  alternates: {
    canonical: "https://www.shaistats.com",
  },
  openGraph: {
    title: "ShAI – NBA Scores, Stats, and AI Insights",
    description: "Track every player and team with real-time data, AI insights, and curated analysis.",
    url: "https://www.shaistats.com",
    siteName: "ShAI",
    images: [
      {
        url: "/shai-logo.png",
        width: 1200,
        height: 630,
        alt: "ShAI dashboard preview",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    site: "@ShAIStats",
    creator: "@ShAIStats",
    title: "ShAI – NBA Scores, Stats, and AI Insights",
    description: "Live NBA data, AI-powered scouting reports, and curated analysis.",
    images: ["/shai-logo.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
  other: {
    "google-adsense-account": "ca-pub-2936132092849787",
  },
};

const HeaderSearchFallback = () => (
  <div className="mx-auto h-12 w-full max-w-[30rem] animate-pulse rounded-full border border-white/10 bg-white/5" aria-hidden="true" />
);

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

const truncateUserName = (value?: string | null) => {
  if (!value) return "there";
  const trimmed = value.trim();
  if (trimmed.length <= 28) return trimmed;
  return `${trimmed.slice(0, 28)}...`;
};

const SiteHeader = async () => {
  const session = await auth();
  const user = session?.user;
  const userName = truncateUserName(user?.name);

  return (
    <header className="sticky top-0 z-20 border-b border-[color:var(--color-app-border)] bg-[var(--color-app-surface-elevated)] backdrop-blur-md">
      <div className="relative mx-auto w-full max-w-7xl px-6 py-4">
        <div className="flex flex-col gap-3">
          <div className="relative flex flex-col items-center gap-4 md:flex-row md:items-center md:gap-6">
            <Link href="/" className="flex shrink-0 items-center gap-3">
              <Image
                src="/aiball.png"
                alt="AI Ball logo"
                width={48}
                height={48}
                priority
                className="h-12 w-12 rounded-full border border-[color:var(--color-app-border)] bg-[color:var(--color-app-logo-badge)] object-contain p-px shadow-sm"
              />
              <span className="text-lg font-bold tracking-[0.10em] text-[var(--color-app-foreground)] md:text-xl">ShAI</span>
            </Link>
            <HeaderNavCluster />
            <div className="flex w-full items-center justify-center md:absolute md:right-0 md:top-1/2 md:w-auto md:-translate-y-1/2 md:justify-end">
              {user ? (
                <div className="surface-card--soft app-offwhite-shell flex items-center gap-2 rounded-full px-3 py-1.5 text-xs md:gap-3 md:px-4 md:py-2 md:text-sm">
                  <span className="rounded-full px-3 py-1 font-medium text-[color:var(--color-app-foreground-muted)] md:text-sm">
                    Hi, {userName}!
                  </span>
                  <form
                    action={async () => {
                      "use server";
                      await signOut();
                    }}
                  >
                    <button
                      type="submit"
                      className="rounded-full border border-[color:var(--color-app-border)] bg-[var(--color-app-background)] px-3 py-1 text-[0.65rem] font-medium text-[color:var(--color-app-foreground-muted)] transition hover:border-[color:var(--color-app-border-strong)] hover:bg-[var(--color-app-background-soft)] hover:text-[var(--color-app-foreground)] md:text-xs"
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
          <Suspense fallback={<HeaderSearchFallback />}>
            <HeaderSearchBar />
          </Suspense>
        </div>
      </div>
    </header>
  );
};

const SiteFooter = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-[color:var(--color-app-border)] bg-[var(--color-app-surface-elevated)]">
      <div className="mx-auto w-full max-w-7xl px-6 py-12">
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
        <div className="mt-8 flex flex-col gap-4 text-xs text-[color:var(--color-app-foreground-muted)] sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p>© {currentYear} ShAI. All rights reserved.</p>
            <p>
              This project is not affiliated with, endorsed by, or associated with the National Basketball Association nor Shai Gilgeous-Alexander.
            </p>
          </div>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
};
