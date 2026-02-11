export default function Loading() {
  return (
    <div
      className="relative left-1/2 w-[min(88rem,calc(100vw-1.5rem))] -translate-x-1/2 space-y-8 sm:w-[min(88rem,calc(100vw-3rem))]"
      aria-hidden="true"
    >
      <div className="skeleton-block h-4 w-28 rounded-full bg-white/10" />

      <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 sm:p-6">
        <div className="mx-auto max-w-xl space-y-3 text-center">
          <div className="skeleton-block mx-auto h-3 w-20 rounded-full bg-white/10" />
          <div className="skeleton-block mx-auto h-10 w-72 rounded-2xl bg-white/10" />
          <div className="skeleton-block mx-auto h-4 w-56 rounded-full bg-white/10" />
          <div className="skeleton-block mx-auto h-4 w-80 rounded-full bg-white/10" />
        </div>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="w-full max-w-[19rem] rounded-2xl border border-white/10 bg-slate-900/60 p-4">
              <div className="skeleton-block h-3 w-40 rounded-full bg-white/10" />
              <div className="skeleton-block mx-auto mt-3 h-[95px] w-[130px] rounded-xl bg-white/10" />
              <div className="skeleton-block mx-auto mt-2 h-5 w-36 rounded-full bg-white/10" />
              <div className="skeleton-block mx-auto mt-2 h-3 w-44 rounded-full bg-white/10" />
              <div className="skeleton-block mx-auto mt-2 h-3 w-24 rounded-full bg-white/10" />
            </div>
          ))}
        </div>

        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="skeleton-block mx-auto h-3 w-24 rounded-full bg-white/10" />
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="skeleton-block h-7 w-28 rounded-full bg-white/10" />
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
        <div className="space-y-2">
          <div className="skeleton-block h-3 w-24 rounded-full bg-white/10" />
          <div className="skeleton-block h-6 w-40 rounded-2xl bg-white/10" />
        </div>
        <div className="mt-4 space-y-2">
          <div className="skeleton-block h-10 w-full rounded-2xl bg-white/10" />
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="skeleton-block h-10 w-full rounded-2xl bg-white/10" />
          ))}
        </div>
      </section>

      <section className="space-y-6 rounded-3xl border border-white/10 bg-slate-950/60 p-6">
        <div className="space-y-2">
          <div className="skeleton-block h-3 w-36 rounded-full bg-white/10" />
          <div className="skeleton-block h-6 w-64 rounded-2xl bg-white/10" />
        </div>
        {Array.from({ length: 2 }).map((_, teamIndex) => (
          <div key={teamIndex} className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between">
              <div className="skeleton-block h-6 w-44 rounded-2xl bg-white/10" />
              <div className="skeleton-block h-3 w-16 rounded-full bg-white/10" />
            </div>
            <div className="mt-4 space-y-2">
              {Array.from({ length: 8 }).map((_, rowIndex) => (
                <div key={rowIndex} className="skeleton-block h-8 w-full rounded-xl bg-white/10" />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-6 rounded-3xl border border-white/10 bg-slate-950/60 p-6">
        <div className="space-y-2">
          <div className="skeleton-block h-3 w-32 rounded-full bg-white/10" />
          <div className="skeleton-block h-6 w-52 rounded-2xl bg-white/10" />
          <div className="skeleton-block h-4 w-96 max-w-full rounded-full bg-white/10" />
        </div>
        {Array.from({ length: 2 }).map((_, teamIndex) => (
          <div key={teamIndex} className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between">
              <div className="skeleton-block h-6 w-44 rounded-2xl bg-white/10" />
              <div className="skeleton-block h-3 w-16 rounded-full bg-white/10" />
            </div>
            <div className="mt-4 space-y-2">
              {Array.from({ length: 7 }).map((_, rowIndex) => (
                <div key={rowIndex} className="skeleton-block h-8 w-full rounded-xl bg-white/10" />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
