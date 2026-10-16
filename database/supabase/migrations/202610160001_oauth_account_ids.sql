-- Direct PostgreSQL access stores the OAuth provider's subject as text.
-- UUID values from existing accounts retain their original string value.
ALTER TABLE public.user_accounts
  DROP CONSTRAINT IF EXISTS user_accounts_auth_user_id_fkey;
ALTER TABLE public.user_accounts
  ALTER COLUMN auth_user_id TYPE text USING auth_user_id::text;
