export default function Loading() {
  return (
    <div className="space-y-12" aria-hidden="true">
      <section className="flex flex-col gap-8 text-center sm:gap-12 md:gap-16">
        <div className="space-y-4">
          <div className="skeleton-block mx-auto h-8 w-56 rounded-2xl bg-white/10 sm:h-10 sm:w-72" />
          <div className="skeleton-block mx-auto h-4 w-3/4 max-w-2xl rounded-full bg-white/10 sm:h-5" />
        </div>
        <div className="skeleton-block mx-auto h-[52px] w-full max-w-3xl rounded-full border border-white/10 bg-white/5 sm:h-[68px]" />
      </section>

      <section className="mt-12 sm:mt-16 lg:mt-20 space-y-6">
        <div className="flex items-end justify-between">
          <div className="space-y-2">
            <div className="skeleton-block h-3 w-28 rounded-full bg-white/10" />
            <div className="skeleton-block h-6 w-40 rounded-2xl bg-white/10" />
          </div>
          <div className="skeleton-block h-4 w-28 rounded-full bg-white/10" />
        </div>
        <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="skeleton-block h-36 rounded-3xl border border-white/10 bg-slate-900/60" />
          ))}
        </div>
      </section>

      <section className="mt-12 sm:mt-16 lg:mt-20 space-y-6">
        <div className="flex items-end justify-between">
          <div className="space-y-2">
            <div className="skeleton-block h-3 w-32 rounded-full bg-white/10" />
            <div className="skeleton-block h-6 w-48 rounded-2xl bg-white/10" />
          </div>
          <div className="skeleton-block h-4 w-28 rounded-full bg-white/10" />
        </div>
        <div className="grid gap-4 sm:gap-6 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="skeleton-block h-40 rounded-3xl border border-white/10 bg-slate-900/60" />
          ))}
        </div>
      </section>

      <section className="mt-12 sm:mt-16 lg:mt-20 space-y-6">
        <div className="flex items-end justify-between">
          <div className="space-y-2">
            <div className="skeleton-block h-3 w-32 rounded-full bg-white/10" />
            <div className="skeleton-block h-6 w-44 rounded-2xl bg-white/10" />
          </div>
          <div className="skeleton-block h-4 w-28 rounded-full bg-white/10" />
        </div>
        <div className="skeleton-block h-80 rounded-3xl border border-white/10 bg-slate-900/60" />
      </section>

      <section className="mt-12 sm:mt-16 lg:mt-20 space-y-6">
        <div className="flex items-end justify-between">
          <div className="space-y-2">
            <div className="skeleton-block h-3 w-24 rounded-full bg-white/10" />
            <div className="skeleton-block h-6 w-36 rounded-2xl bg-white/10" />
          </div>
          <div className="skeleton-block h-4 w-28 rounded-full bg-white/10" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton-block h-36 rounded-3xl border border-white/10 bg-slate-900/60" />
          ))}
        </div>
      </section>
    </div>
  );
}
