import Link from "next/link";

import { auth, signOut } from "@/auth";

export default async function LogoutPage() {
  const session = await auth();

  const handleSignOut = async () => {
    "use server";
    await signOut({ redirectTo: "/" });
  };

  return (
    <div className="space-y-8 text-white">
      <div>
        <p className="text-xs uppercase tracking-[0.5em] text-blue-300/70">Secure exit</p>
        <h1 className="mt-3 text-3xl font-semibold">Sign out of NBAI</h1>
        <p className="mt-2 text-sm text-white/70">End your session on this device. You can always sign in again with Google.</p>
      </div>

      {session?.user ? (
        <>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
            <p className="font-semibold text-white">{session.user.name ?? session.user.email}</p>
            <p className="text-xs text-white/60">{session.user.email}</p>
          </div>
          <form action={handleSignOut}>
            <button className="w-full rounded-2xl border border-white/20 bg-transparent px-6 py-3 text-sm font-semibold text-white transition hover:border-red-400 hover:bg-red-500/10">
              Sign out everywhere
            </button>
          </form>
        </>
      ) : (
        <div className="space-y-3 text-sm text-white/70">
          <p>You are not currently signed in.</p>
          <Link href="/(auth)/signin" className="text-blue-300 hover:text-blue-200">
            Sign in to continue
          </Link>
        </div>
      )}
    </div>
  );
}
