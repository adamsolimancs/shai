export default function Loading() {
  return (
    <div className="space-y-12" aria-hidden="true">
      <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="w-full rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface)] px-5 py-5 shadow-lg shadow-[rgba(10,31,68,0.08)]">
          <div className="flex h-full flex-col gap-4">
            <div className="flex items-center gap-4">
              <div className="skeleton-block h-28 w-28 rounded-full border border-[color:rgba(var(--color-app-foreground-rgb),0.15)] bg-[color:rgba(var(--color-app-foreground-rgb),0.08)] md:h-32 md:w-32" />
              <div className="flex-1 space-y-3">
                <div className="skeleton-block h-3 w-32 rounded-full bg-[color:rgba(var(--color-app-primary-rgb),0.4)]" />
                <div className="skeleton-block h-8 w-52 rounded-2xl bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
              </div>
            </div>
            <div className="skeleton-block h-4 w-3/4 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="skeleton-block h-16 rounded-2xl border border-[color:var(--color-app-border)] bg-[color:rgba(var(--color-app-foreground-rgb),0.04)]" />
              <div className="skeleton-block h-16 rounded-2xl border border-[color:var(--color-app-border)] bg-[color:rgba(var(--color-app-foreground-rgb),0.04)]" />
              <div className="skeleton-block h-16 rounded-2xl border border-[color:var(--color-app-border)] bg-[color:rgba(var(--color-app-foreground-rgb),0.04)]" />
            </div>
            <div className="skeleton-block h-20 rounded-2xl border border-[color:var(--color-app-border)] bg-[color:rgba(var(--color-app-foreground-rgb),0.05)]" />
            <div className="skeleton-block h-36 rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-background-soft)]" />
          </div>
        </section>
        <aside className="flex h-full w-full flex-col rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)] p-5 shadow-xl shadow-[rgba(10,31,68,0.15)]">
          <div className="skeleton-block h-5 w-40 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
          <div className="mt-6 space-y-3">
            <div className="skeleton-block h-20 rounded-2xl border border-[color:var(--color-app-border)] bg-[color:rgba(var(--color-app-foreground-rgb),0.05)]" />
            <div className="skeleton-block h-20 rounded-2xl border border-[color:var(--color-app-border)] bg-[color:rgba(var(--color-app-foreground-rgb),0.05)]" />
            <div className="skeleton-block h-20 rounded-2xl border border-[color:var(--color-app-border)] bg-[color:rgba(var(--color-app-foreground-rgb),0.05)]" />
          </div>
        </aside>
      </div>
      <div className="skeleton-block h-64 rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)]" />
      <div className="skeleton-block h-64 rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)]" />
    </div>
  );
}
