export type AuthFormState = {
  error: string | null;
  success: string | null;
};

export const initialAuthFormState: AuthFormState = {
  error: null,
  success: null,
};
