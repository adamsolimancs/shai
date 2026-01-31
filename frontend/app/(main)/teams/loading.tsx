export default function Loading() {
  return (
    <div className="space-y-12" aria-hidden="true">
      <section className="space-y-6">
        <div className="space-y-3">
          <div className="skeleton-block h-4 w-48 rounded-full bg-white/10" />
          <div className="skeleton-block h-10 w-72 rounded-2xl bg-white/10" />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
              <div className="space-y-3">
                <div className="skeleton-block h-4 w-40 rounded-full bg-white/10" />
                <div className="skeleton-block h-7 w-56 rounded-2xl bg-white/10" />
              </div>
              <div className="mt-6 space-y-3">
                {Array.from({ length: 8 }).map((_, rowIndex) => (
                  <div key={rowIndex} className="flex items-center justify-between">
                    <div className="skeleton-block h-4 w-48 rounded-full bg-white/10" />
                    <div className="skeleton-block h-4 w-24 rounded-full bg-white/10" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-6">
        <div className="space-y-2">
          <div className="skeleton-block h-3 w-32 rounded-full bg-white/10" />
          <div className="skeleton-block h-7 w-64 rounded-2xl bg-white/10" />
          <div className="skeleton-block h-4 w-72 rounded-full bg-white/10" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
              <div className="skeleton-block h-3 w-28 rounded-full bg-white/10" />
              <div className="mt-5 space-y-3">
                {Array.from({ length: 3 }).map((_, rowIndex) => (
                  <div key={rowIndex} className="flex items-center justify-between">
                    <div className="space-y-2">
                      <div className="skeleton-block h-3 w-12 rounded-full bg-white/10" />
                      <div className="skeleton-block h-5 w-28 rounded-2xl bg-white/10" />
                      <div className="skeleton-block h-3 w-16 rounded-full bg-white/10" />
                    </div>
                    <div className="skeleton-block h-8 w-16 rounded-2xl bg-white/10" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="skeleton-block h-3 w-28 rounded-full bg-white/10" />
            <div className="skeleton-block h-7 w-60 rounded-2xl bg-white/10" />
          </div>
          <div className="skeleton-block h-3 w-32 rounded-full bg-white/10" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <div className="skeleton-block h-3 w-16 rounded-full bg-white/10" />
                  <div className="skeleton-block h-6 w-36 rounded-2xl bg-white/10" />
                  <div className="skeleton-block h-3 w-24 rounded-full bg-white/10" />
                </div>
                <div className="skeleton-block h-6 w-12 rounded-full bg-white/10" />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, statIndex) => (
                  <div key={statIndex} className="space-y-2">
                    <div className="skeleton-block h-3 w-10 rounded-full bg-white/10" />
                    <div className="skeleton-block h-5 w-16 rounded-2xl bg-white/10" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="space-y-2">
          <div className="skeleton-block h-3 w-28 rounded-full bg-white/10" />
          <div className="skeleton-block h-7 w-32 rounded-2xl bg-white/10" />
          <div className="skeleton-block h-4 w-80 rounded-full bg-white/10" />
        </div>
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="skeleton-block h-9 w-24 rounded-2xl border border-white/10 bg-slate-950/60" />
          ))}
        </div>
      </section>
    </div>
  );
}
