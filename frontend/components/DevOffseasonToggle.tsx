"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export default function DevOffseasonToggle({ isOffseason }: { isOffseason: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("offseason", isOffseason ? "0" : "1");
    startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      aria-pressed={isOffseason}
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-white/15 bg-slate-950/90 px-3 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur transition hover:border-blue-300/50 disabled:opacity-60"
    >
      <span className={`h-2 w-2 rounded-full ${isOffseason ? "bg-orange-400" : "bg-emerald-400"}`} />
      Dev: {isOffseason ? "offseason" : "in season"}
    </button>
  );
}
