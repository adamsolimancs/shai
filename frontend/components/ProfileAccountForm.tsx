"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { updateProfileAction } from "@/lib/profileActions";
import { initialProfileFormState } from "@/lib/profileFormState";

type ProfileAccountFormProps = {
  accountId: string;
  email: string | null;
  initialName: string;
  initialUsername: string;
  providerLabel: string | null;
};

const FeedbackBanner = ({
  error,
  success,
}: {
  error: string | null;
  success: string | null;
}) => {
  if (!error && !success) {
    return null;
  }

  const isError = Boolean(error);

  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-center text-sm ${
        isError
          ? "border-rose-400/30 bg-rose-500/10 text-rose-100"
          : "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
      }`}
    >
      {error ?? success}
    </div>
  );
};

const SaveButton = () => {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="btn-primary rounded-2xl px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
    >
      {pending ? "Saving..." : "Save changes"}
    </button>
  );
};

const SummaryItem = ({
  label,
  value,
}: {
  label: string;
  value: string;
}) => (
  <div className="rounded-2xl border border-[color:var(--color-app-border)] bg-[var(--color-app-surface)] px-4 py-3">
    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-[color:var(--color-app-foreground-muted)]">
      {label}
    </p>
    <p className="mt-2 break-all text-sm text-[color:var(--color-app-foreground)]">{value}</p>
  </div>
);

export default function ProfileAccountForm({
  accountId,
  email,
  initialName,
  initialUsername,
  providerLabel,
}: ProfileAccountFormProps) {
  const [state, formAction] = useActionState(updateProfileAction, initialProfileFormState);
  const [name, setName] = useState(initialName);
  const [username, setUsername] = useState(initialUsername);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
      <form action={formAction} className="surface-card--soft space-y-5 rounded-[28px] p-6">
        <div className="space-y-2">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-[color:var(--color-app-primary)]">
            Account details
          </p>
          <h2 className="text-2xl font-semibold text-[color:var(--color-app-foreground)]">Edit your profile</h2>
          <p className="text-sm text-[color:var(--color-app-foreground-muted)]">
            Update the app-facing details shown across your signed-in session.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <label
              htmlFor="profile-name"
              className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)]"
            >
              Display name
            </label>
            <input
              id="profile-name"
              name="name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-xl border border-[color:var(--color-app-border)] bg-[var(--color-app-surface)] px-4 py-2.5 text-sm text-[var(--color-app-foreground)] placeholder:text-[color:var(--color-app-foreground-muted)] focus:border-[color:var(--color-app-primary)] focus:outline-none"
              placeholder="Your name"
              autoComplete="name"
              required
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="profile-username"
              className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)]"
            >
              Username
            </label>
            <input
              id="profile-username"
              name="username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value.toLowerCase())}
              className="w-full rounded-xl border border-[color:var(--color-app-border)] bg-[var(--color-app-surface)] px-4 py-2.5 text-sm text-[var(--color-app-foreground)] placeholder:text-[color:var(--color-app-foreground-muted)] focus:border-[color:var(--color-app-primary)] focus:outline-none"
              placeholder="optional_username"
              autoComplete="username"
            />
            <p className="text-xs text-[color:var(--color-app-foreground-muted)]">
              Use 3-24 letters, numbers, or underscores.
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="profile-email"
              className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)]"
            >
              Email
            </label>
            <input
              id="profile-email"
              type="email"
              value={email ?? ""}
              className="w-full rounded-xl border border-[color:var(--color-app-border)] bg-[color:rgba(var(--color-app-foreground-rgb),0.04)] px-4 py-2.5 text-sm text-[color:var(--color-app-foreground-muted)]"
              disabled
              readOnly
            />
            <p className="text-xs text-[color:var(--color-app-foreground-muted)]">
              Email is managed by your sign-in method and can’t be edited here.
            </p>
          </div>
        </div>

        <FeedbackBanner error={state.error} success={state.success} />

        <div className="flex justify-end">
          <SaveButton />
        </div>
      </form>

      <aside className="surface-card--soft space-y-4 rounded-[28px] p-6">
        <div>
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-[color:var(--color-app-primary)]">
            Overview
          </p>
          <h2 className="mt-2 text-xl font-semibold text-[color:var(--color-app-foreground)]">Current account</h2>
        </div>

        <div className="grid gap-3">
          {email ? <SummaryItem label="Email" value={email} /> : null}
          {providerLabel ? <SummaryItem label="Sign-in method" value={providerLabel} /> : null}
          <SummaryItem label="Account ID" value={accountId} />
        </div>
      </aside>
    </div>
  );
}
