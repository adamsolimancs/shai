"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { resolveSeasonalMode } from "@/lib/seasonMode";

const Skeleton = ({ className }: { className: string }) => (
  <div className={`skeleton-block bg-[color:rgba(var(--color-app-foreground-rgb),0.1)] ${className}`} />
);

function HeroSkeleton() {
  return <section className="flex flex-col gap-8 text-center sm:gap-12 md:gap-16"><div className="space-y-4"><Skeleton className="mx-auto h-8 w-56 rounded-2xl sm:h-10 sm:w-72" /><Skeleton className="mx-auto h-4 w-3/4 max-w-2xl rounded-full sm:h-5" /></div><Skeleton className="mx-auto h-[52px] w-full max-w-3xl rounded-full border border-[color:var(--color-app-border)] sm:h-[68px]" /></section>;
}

function RecapHeadingSkeleton({ width = "w-44" }: { width?: string }) {
  return <div className="flex items-end justify-between gap-4 border-b border-[color:var(--color-app-border)] pb-3"><Skeleton className={`h-7 rounded-2xl sm:h-9 ${width}`} /><Skeleton className="h-3 w-24 rounded-full" /></div>;
}

function OffseasonSkeleton() {
  return <div className="offseason-recap mt-16 space-y-4 sm:mt-20 sm:space-y-5">
    <section className="py-8 sm:py-10"><Skeleton className="mb-10 h-9 w-64 rounded-2xl sm:h-12 sm:w-96" /><RecapHeadingSkeleton width="w-40" /><div className="grid sm:grid-cols-5">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="border-b border-[color:var(--color-app-border)] py-5 sm:border-b-0 sm:border-r sm:px-5 sm:first:pl-0 sm:last:border-r-0"><Skeleton className="h-8 w-8 rounded-xl" /><Skeleton className="mt-5 h-4 w-28 rounded-full" /><Skeleton className="mt-3 h-3 w-12 rounded-full" /><Skeleton className="mt-5 h-9 w-24 rounded-2xl" /></div>)}</div></section>
    <section className="offseason-band py-8 sm:py-10"><RecapHeadingSkeleton width="w-36" /><div className="grid gap-8 pt-7 lg:grid-cols-[1.15fr_0.85fr]"><Skeleton className="h-48 rounded-3xl border border-[color:var(--color-app-border)]" /><div className="space-y-4"><Skeleton className="h-5 w-48 rounded-full" />{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-10 w-full rounded-xl" />)}</div></div></section>
    <section className="py-8 sm:py-10"><RecapHeadingSkeleton width="w-48" /><div className="grid gap-x-8 pt-5 sm:grid-cols-2">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="my-2 h-14 rounded-xl" />)}</div></section>
    <section className="offseason-band py-8 sm:py-10"><RecapHeadingSkeleton /><div className="grid sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="space-y-4 py-6 sm:px-6 sm:first:pl-0"><Skeleton className="h-4 w-20 rounded-full" /><Skeleton className="h-4 w-32 rounded-full" /><Skeleton className="h-9 w-24 rounded-2xl" /></div>)}</div></section>
  </div>;
}

function InSeasonSkeleton() {
  return <div className="space-y-12">{[6, 6, 1, 4].map((count, sectionIndex) => <section key={sectionIndex} className="mt-12 space-y-6 sm:mt-16 lg:mt-20"><div className="flex items-end justify-between"><div className="space-y-2"><Skeleton className="h-3 w-28 rounded-full" /><Skeleton className="h-6 w-44 rounded-2xl" /></div><Skeleton className="h-4 w-28 rounded-full" /></div><div className={count === 1 ? "" : `grid gap-4 ${sectionIndex === 3 ? "md:grid-cols-2" : "md:grid-cols-3"}`}>{Array.from({ length: count }).map((_, index) => <Skeleton key={index} className={`${count === 1 ? "h-80" : "h-36"} rounded-3xl border border-[color:var(--color-app-border)]`} />)}</div></section>)}</div>;
}

function SeasonalSkeleton() {
  const searchParams = useSearchParams();
  const isOffseason = resolveSeasonalMode(new Date(), searchParams.get("offseason") ?? undefined) === "offseason";
  return <>{isOffseason ? <OffseasonSkeleton /> : <InSeasonSkeleton />}</>;
}

export default function Loading() {
  const dateBasedFallback = resolveSeasonalMode(new Date()) === "offseason" ? <OffseasonSkeleton /> : <InSeasonSkeleton />;
  return <div className="loading-shell" aria-hidden="true"><HeroSkeleton /><Suspense fallback={dateBasedFallback}><SeasonalSkeleton /></Suspense></div>;
}
