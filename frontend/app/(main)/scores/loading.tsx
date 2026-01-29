export default function Loading() {
  return (
    <div className="space-y-12" aria-hidden="true">
      <header className="space-y-3">
        <div className="space-y-2">
          <div className="skeleton-block h-3 w-40 rounded-full bg-white/10" />
          <div className="skeleton-block h-8 w-72 rounded-2xl bg-white/10" />
        </div>
      </header>

      <section className="space-y-6">
        <div>
          <div className="skeleton-block h-6 w-40 rounded-2xl bg-white/10" />
        </div>
        <div className="space-y-8">
          {Array.from({ length: 2 }).map((_, groupIndex) => (
            <div key={groupIndex} className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="skeleton-block h-4 w-36 rounded-full bg-white/10" />
                <div className="skeleton-block h-3 w-20 rounded-full bg-white/10" />
              </div>
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="skeleton-block h-36 rounded-3xl border border-white/10 bg-slate-900/60" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
