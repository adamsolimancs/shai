"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";
import { initialAuthFormState, type AuthFormState } from "@/lib/authFormState";
import {
  hasSupabasePasswordConfigured,
  signUpSupabasePasswordUser,
  SupabaseAuthError,
} from "@/lib/supabaseAuth";
import { syncUserAccount } from "@/lib/userAccountsApi";

const isProduction = process.env.NODE_ENV === "production";

const signInUnavailableMessage = isProduction
  ? "Email/password sign-in is unavailable right now."
  : "Email/password sign-in is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY.";

const signUpUnavailableMessage = isProduction
  ? "Email/password sign-up is unavailable right now."
  : "Email/password sign-up is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY.";

const getField = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
};

const handleAuthError = (error: unknown): AuthFormState => {
  if (error instanceof AuthError) {
    return {
      error:
        error.type === "CredentialsSignin"
          ? "Invalid email, username, or password."
          : "Authentication failed. Please try again.",
      success: null,
    };
  }

  if (error instanceof SupabaseAuthError) {
    return {
      error: isProduction ? error.message.replace(/supabase/gi, "email/password") : error.message,
      success: null,
    };
  }

  throw error;
};

export async function signInWithPasswordAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!hasSupabasePasswordConfigured) {
    return {
      error: signInUnavailableMessage,
      success: null,
    };
  }

  const identifier = getField(formData, "identifier").toLowerCase();
  const password = getField(formData, "password");
  if (!identifier || !password) {
    return { error: "Email or username and password are required.", success: null };
  }

  try {
    await signIn("credentials", {
      identifier,
      password,
      redirectTo: "/",
    });
  } catch (error) {
    return handleAuthError(error);
  }

  return initialAuthFormState;
}

export async function signUpWithPasswordAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!hasSupabasePasswordConfigured) {
    return {
      error: signUpUnavailableMessage,
      success: null,
    };
  }

  const firstName = getField(formData, "firstName");
  const lastName = getField(formData, "lastName");
  const username = getField(formData, "username");
  const email = getField(formData, "email").toLowerCase();
  const password = getField(formData, "password");

  if (!firstName || !lastName || !username || !email || !password) {
    return { error: "First name, last name, username, email, and password are required.", success: null };
  }

  if (!/^[a-z0-9_]{3,24}$/i.test(username)) {
    return {
      error: "Username must be 3-24 characters and use only letters, numbers, or underscores.",
      success: null,
    };
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters.", success: null };
  }

  try {
    const result = await signUpSupabasePasswordUser({
      firstName,
      lastName,
      username,
      email,
      password,
    });

    if (!result.user) {
      return {
        error: "We couldn't create your account. Please try again.",
        success: null,
      };
    }

    try {
      await syncUserAccount({
        auth_user_id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        username: result.user.username,
      });
    } catch {
      // Best effort only. A later credentials sign-in will backfill the record.
    }

    if (!result.hasSession) {
      return {
        error: null,
        success:
          "Account created. Check your inbox to confirm your email before signing in.",
      };
    }

    await signIn("credentials", {
      identifier: email,
      password,
      redirectTo: "/",
    });
  } catch (error) {
    return handleAuthError(error);
  }

  return initialAuthFormState;
}
