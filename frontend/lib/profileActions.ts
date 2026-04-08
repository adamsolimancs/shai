"use server";

import { auth, unstable_update } from "@/auth";
import { initialProfileFormState, type ProfileFormState } from "@/lib/profileFormState";
import { syncUserAccount } from "@/lib/userAccountsApi";

const getField = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
};

export async function updateProfileAction(
  _prevState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const session = await auth();

  if (!session?.user) {
    return {
      error: "You need to sign in to update your profile.",
      success: null,
    };
  }

  const name = getField(formData, "name");
  const username = getField(formData, "username").toLowerCase();

  if (!name) {
    return {
      error: "Display name is required.",
      success: null,
    };
  }

  if (name.length > 80) {
    return {
      error: "Display name must be 80 characters or fewer.",
      success: null,
    };
  }

  if (username && !/^[a-z0-9_]{3,24}$/i.test(username)) {
    return {
      error: "Username must be 3-24 characters and use only letters, numbers, or underscores.",
      success: null,
    };
  }

  if (session.user.provider === "credentials" && session.user.email) {
    try {
      await syncUserAccount({
        auth_user_id: session.user.id,
        email: session.user.email,
        name,
        username: username || null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "We couldn't save your profile.";
      return {
        error: message,
        success: null,
      };
    }
  }

  await unstable_update({
    user: {
      name,
      username: username || null,
    },
  });

  return {
    ...initialProfileFormState,
    success: "Profile updated.",
  };
}
