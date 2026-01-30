export default function Loading() {
  return (
    <div className="space-y-12" aria-hidden="true">
      <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="w-full rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface)] px-5 py-5 shadow-lg shadow-[rgba(10,31,68,0.08)]">
          <div className="flex h-full flex-col gap-4 text-[color:var(--color-app-foreground)]">
            <div className="grid gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.7fr)]">
              <div className="flex flex-col items-center gap-4 text-center md:self-center md:-translate-y-3">
                <div className="rounded-full border border-[color:rgba(var(--color-app-foreground-rgb),0.15)] bg-[color:rgba(var(--color-app-foreground-rgb),0.08)] p-2 backdrop-blur">
                  <div className="skeleton-block h-28 w-28 rounded-full border border-[color:rgba(var(--color-app-foreground-rgb),0.35)] bg-[color:rgba(var(--color-app-foreground-rgb),0.12)] md:h-32 md:w-32" />
                </div>
                <div className="space-y-2">
                  <div className="skeleton-block h-3 w-28 rounded-full bg-[color:rgba(var(--color-app-primary-rgb),0.4)]" />
                  <div className="skeleton-block h-8 w-48 rounded-2xl bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
                </div>
              </div>
              <div className="w-full justify-self-end md:max-w-[14rem]">
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="space-y-2">
                      <div className="skeleton-block h-2 w-16 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.18)]" />
                      <div className="skeleton-block h-4 w-28 rounded-2xl bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-background-soft)] p-4">
              <div className="flex items-center gap-4">
                <div className="skeleton-block h-3 w-24 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.2)]" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton-block h-8 w-20 rounded-2xl bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
                  <div className="skeleton-block h-2 w-full rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.14)]" />
                  <div className="skeleton-block h-3 w-36 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-background-soft)] p-4">
              <div className="flex items-center justify-between">
                <div className="skeleton-block h-3 w-24 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.2)]" />
                <div className="skeleton-block h-3 w-10 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="skeleton-block h-6 w-20 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]"
                  />
                ))}
              </div>
              <div className="mt-3 space-y-2">
                <div className="skeleton-block h-4 w-2/3 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.15)]" />
                <div className="skeleton-block h-4 w-4/5 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
                <div className="skeleton-block h-4 w-1/2 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.1)]" />
              </div>
            </div>
          </div>
        </section>
        <aside className="flex h-full w-full flex-col rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)] p-5 shadow-xl shadow-[rgba(10,31,68,0.15)]">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="skeleton-block h-3 w-20 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.2)]" />
              <div className="skeleton-block h-6 w-40 rounded-2xl bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
            </div>
            <div className="skeleton-block h-3 w-16 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
          </div>
          <div className="mt-4 flex-1 space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="rounded-2xl border border-[color:var(--color-app-border)] bg-[color:rgba(var(--color-app-foreground-rgb),0.05)] px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <div className="skeleton-block h-3 w-32 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.18)]" />
                    <div className="skeleton-block h-3 w-24 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
                  </div>
                  <div className="skeleton-block h-3 w-12 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
                </div>
                <div className="mt-3 space-y-2">
                  <div className="skeleton-block h-4 w-2/3 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.14)]" />
                  <div className="skeleton-block h-4 w-1/2 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="skeleton-block h-3 w-32 rounded-full bg-[color:rgba(var(--color-app-primary-rgb),0.3)]" />
            <div className="skeleton-block h-7 w-56 rounded-2xl bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
          </div>
          <div className="skeleton-block h-8 w-48 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
        </div>
        <div className="skeleton-block h-64 rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)]" />
        <div className="skeleton-block h-64 rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)]" />
      </div>
    </div>
  );
}
