"use client";

import { Eye, EyeOff } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  signInWithPasswordAction,
  signUpWithPasswordAction,
} from "@/lib/authActions";
import { initialAuthFormState } from "@/lib/authFormState";

type PasswordFormProps = {
  enabled: boolean;
};

type SignInFields = {
  identifier: string;
  password: string;
};

type SignUpFields = {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  password: string;
};

const signInUnavailableMessage =
  process.env.NODE_ENV === "production"
    ? "Email/password sign-in is unavailable right now."
    : "Email/password sign-in is disabled. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY in .env.";

const signUpUnavailableMessage =
  process.env.NODE_ENV === "production"
    ? "Email/password sign-up is unavailable right now."
    : "Email/password sign-up is disabled. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY in .env.";

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

const PasswordField = ({
  id,
  name,
  label,
  placeholder,
  autoComplete,
  value,
  onChange,
  disabled,
  minLength,
}: {
  id: string;
  name: string;
  label: string;
  placeholder: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  minLength?: number;
}) => {
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)]">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          className="w-full rounded-xl border border-[color:var(--color-app-border)] bg-[var(--color-app-surface)] px-4 py-2.5 pr-12 text-sm text-[var(--color-app-foreground)] placeholder:text-[color:var(--color-app-foreground-muted)] focus:border-[color:var(--color-app-primary)] focus:outline-none"
          autoComplete={autoComplete}
          minLength={minLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          required
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-[color:var(--color-app-foreground-muted)] transition hover:text-[color:var(--color-app-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-app-primary-soft)] disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          disabled={disabled}
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
};

export function EmailSignInForm({ enabled }: PasswordFormProps) {
  const [state, formAction] = useActionState(signInWithPasswordAction, initialAuthFormState);
  const [fields, setFields] = useState<SignInFields>({
    identifier: "",
    password: "",
  });

  const updateField = (name: keyof SignInFields, value: string) => {
    setFields((current) => ({
      ...current,
      [name]: value,
    }));
  };

  return (
    <form action={formAction} className="surface-card--soft space-y-4 rounded-2xl p-5">
      <div className="space-y-2">
        <label htmlFor="identifier" className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)]">
          Email or username
        </label>
        <input
          id="identifier"
          name="identifier"
          type="text"
          placeholder="jalen-brunson@shai.app or brunson11"
          className="w-full rounded-xl border border-[color:var(--color-app-border)] bg-[var(--color-app-surface)] px-4 py-2.5 text-sm text-[var(--color-app-foreground)] placeholder:text-[color:var(--color-app-foreground-muted)] focus:border-[color:var(--color-app-primary)] focus:outline-none"
          autoComplete="username"
          value={fields.identifier}
          onChange={(event) => updateField("identifier", event.target.value)}
          disabled={!enabled}
          required
        />
      </div>
      <PasswordField
        id="password"
        name="password"
        label="Password"
        placeholder="••••••••"
        autoComplete="current-password"
        value={fields.password}
        onChange={(value) => updateField("password", value)}
        disabled={!enabled}
      />
      {!enabled && (
        <p className="text-xs text-amber-300">{signInUnavailableMessage}</p>
      )}
      <AuthFeedback error={state.error} success={state.success} />
      <SubmitButton
        label="Continue with email or username"
        pendingLabel="Signing in..."
        disabled={!enabled}
      />
    </form>
  );
}

export function EmailSignUpForm({ enabled }: PasswordFormProps) {
  const [state, formAction] = useActionState(signUpWithPasswordAction, initialAuthFormState);
  const [fields, setFields] = useState<SignUpFields>({
    firstName: "",
    lastName: "",
    username: "",
    email: "",
    password: "",
  });

  const updateField = (name: keyof SignUpFields, value: string) => {
    setFields((current) => ({
      ...current,
      [name]: value,
    }));
  };

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
            value={fields.firstName}
            onChange={(event) => updateField("firstName", event.target.value)}
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
            value={fields.lastName}
            onChange={(event) => updateField("lastName", event.target.value)}
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
          value={fields.username}
          onChange={(event) => updateField("username", event.target.value)}
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
          value={fields.email}
          onChange={(event) => updateField("email", event.target.value)}
          disabled={!enabled}
          required
        />
      </div>
      <PasswordField
        id="signup-password"
        name="password"
        label="Password"
        placeholder="••••••••"
        autoComplete="new-password"
        minLength={8}
        value={fields.password}
        onChange={(value) => updateField("password", value)}
        disabled={!enabled}
      />
      {!enabled && (
        <p className="text-xs text-amber-300">{signUpUnavailableMessage}</p>
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
