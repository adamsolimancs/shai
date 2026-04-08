import { redirect } from "next/navigation";

import { auth } from "@/auth";
import ProfileAccountForm from "@/components/ProfileAccountForm";

const providerLabel = (provider: string | null | undefined) => {
  if (!provider) {
    return null;
  }

  if (provider === "credentials") {
    return "Email/password";
  }

  if (provider === "google") {
    return "Google";
  }

  return provider.charAt(0).toUpperCase() + provider.slice(1);
};

const fallbackName = (name: string | null | undefined, email: string | null | undefined) => {
  if (typeof name === "string" && name.trim()) {
    return name.trim();
  }

  if (typeof email === "string" && email.includes("@")) {
    return email.split("@")[0] ?? "ShAI user";
  }

  return "ShAI user";
};

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  return (
    <div className="space-y-8 text-[var(--color-app-foreground)]">
      <div className="space-y-3">
        <p className="inline-flex items-center rounded-full bg-[color:var(--color-app-primary)] px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-[color:var(--color-app-primary-foreground)] shadow-sm">
          Profile
        </p>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold">Manage your account</h1>
          <p className="max-w-2xl text-sm text-[color:var(--color-app-foreground-muted)]">
            Review the essentials tied to your current sign-in and update the details the app displays for you.
          </p>
        </div>
      </div>

      <ProfileAccountForm
        accountId={session.user.id}
        email={session.user.email ?? null}
        initialName={fallbackName(session.user.name, session.user.email)}
        initialUsername={session.user.username ?? ""}
        providerLabel={providerLabel(session.user.provider)}
      />
    </div>
  );
}
