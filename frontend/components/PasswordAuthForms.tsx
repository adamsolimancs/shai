"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  signInWithPasswordAction,
  signUpWithPasswordAction,
} from "@/lib/authActions";
import { initialAuthFormState } from "@/lib/authFormState";

type PasswordFormProps = {
  enabled: boolean;
};

const AuthFeedback = ({
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
      className={`rounded-2xl border px-4 py-3 text-sm ${
        isError
          ? "border-rose-400/30 bg-rose-500/10 text-rose-100"
          : "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
      }`}
    >
      {error ?? success}
    </div>
  );
};

const SubmitButton = ({
  label,
  pendingLabel,
  disabled,
}: {
  label: string;
  pendingLabel: string;
  disabled?: boolean;
}) => {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="btn-primary w-full rounded-2xl px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
};

export function EmailSignInForm({ enabled }: PasswordFormProps) {
  const [state, formAction] = useActionState(signInWithPasswordAction, initialAuthFormState);

  return (
    <form action={formAction} className="surface-card--soft space-y-4 rounded-2xl p-5">
      <div className="space-y-2">
        <label htmlFor="email" className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)]">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder="jalen-brunson@shai.app"
          className="w-full rounded-xl border border-[color:var(--color-app-border)] bg-[var(--color-app-surface)] px-4 py-2.5 text-sm text-[var(--color-app-foreground)] placeholder:text-[color:var(--color-app-foreground-muted)] focus:border-[color:var(--color-app-primary)] focus:outline-none"
          autoComplete="email"
          disabled={!enabled}
          required
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)]">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          placeholder="••••••••"
          className="w-full rounded-xl border border-[color:var(--color-app-border)] bg-[var(--color-app-surface)] px-4 py-2.5 text-sm text-[var(--color-app-foreground)] placeholder:text-[color:var(--color-app-foreground-muted)] focus:border-[color:var(--color-app-primary)] focus:outline-none"
          autoComplete="current-password"
          disabled={!enabled}
          required
        />
      </div>
      {!enabled && (
        <p className="text-xs text-amber-300">
          Email/password sign-in is disabled. Set <code className="text-[11px]">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="text-[11px]">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY</code> in <code className="text-[11px]">.env</code>.
        </p>
      )}
      <AuthFeedback error={state.error} success={state.success} />
      <SubmitButton
        label="Continue with email"
        pendingLabel="Signing in..."
        disabled={!enabled}
      />
    </form>
  );
}

export function EmailSignUpForm({ enabled }: PasswordFormProps) {
  const [state, formAction] = useActionState(signUpWithPasswordAction, initialAuthFormState);

  return (
    <form action={formAction} className="surface-card--soft space-y-4 rounded-2xl p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="firstName" className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)]">
            First name
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            placeholder="Austin"
            className="w-full rounded-xl border border-[color:var(--color-app-border)] bg-[var(--color-app-surface)] px-4 py-2.5 text-sm text-[var(--color-app-foreground)] placeholder:text-[color:var(--color-app-foreground-muted)] focus:border-[color:var(--color-app-primary)] focus:outline-none"
            autoComplete="given-name"
            disabled={!enabled}
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="lastName" className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)]">
            Last name
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            placeholder="Reaves"
            className="w-full rounded-xl border border-[color:var(--color-app-border)] bg-[var(--color-app-surface)] px-4 py-2.5 text-sm text-[var(--color-app-foreground)] placeholder:text-[color:var(--color-app-foreground-muted)] focus:border-[color:var(--color-app-primary)] focus:outline-none"
            autoComplete="family-name"
            disabled={!enabled}
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="username" className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)]">
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          placeholder="austinreaves"
          className="w-full rounded-xl border border-[color:var(--color-app-border)] bg-[var(--color-app-surface)] px-4 py-2.5 text-sm text-[var(--color-app-foreground)] placeholder:text-[color:var(--color-app-foreground-muted)] focus:border-[color:var(--color-app-primary)] focus:outline-none"
          autoComplete="username"
          disabled={!enabled}
          required
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="email" className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)]">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder="you@shai.app"
          className="w-full rounded-xl border border-[color:var(--color-app-border)] bg-[var(--color-app-surface)] px-4 py-2.5 text-sm text-[var(--color-app-foreground)] placeholder:text-[color:var(--color-app-foreground-muted)] focus:border-[color:var(--color-app-primary)] focus:outline-none"
          autoComplete="email"
          disabled={!enabled}
          required
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)]">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          placeholder="••••••••"
          className="w-full rounded-xl border border-[color:var(--color-app-border)] bg-[var(--color-app-surface)] px-4 py-2.5 text-sm text-[var(--color-app-foreground)] placeholder:text-[color:var(--color-app-foreground-muted)] focus:border-[color:var(--color-app-primary)] focus:outline-none"
          autoComplete="new-password"
          minLength={8}
          disabled={!enabled}
          required
        />
      </div>
      {!enabled && (
        <p className="text-xs text-amber-300">
          Email/password sign-up is disabled. Set <code className="text-[11px]">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="text-[11px]">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY</code> in <code className="text-[11px]">.env</code>.
        </p>
      )}
      <AuthFeedback error={state.error} success={state.success} />
      <SubmitButton
        label="Create Account"
        pendingLabel="Creating account..."
        disabled={!enabled}
      />
    </form>
  );
}
