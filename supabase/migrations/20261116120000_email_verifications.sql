-- email_verifications: single-use email verification links (FR-1, AD-19, Story 1.3 part 2).
-- Only a SHA-256 hash of each token is stored; the token itself exists only in the emailed link.
create table public.email_verifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  -- Hex SHA-256 of the URL-safe token.
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_at timestamptz not null default now(),
  -- 24 hours after created_at.
  expires_at timestamptz not null,
  -- Set when the link is opened successfully; a used link never works again.
  used_at timestamptz,
  -- Set when a newer link replaces this one (resend, Story 7.3).
  invalidated_at timestamptz
);

create index email_verifications_account_id_idx on public.email_verifications (account_id);
-- At most one live (unused, not replaced) link per Account.
create unique index email_verifications_one_live_idx on public.email_verifications (account_id)
  where used_at is null and invalidated_at is null;

-- The browser reads app data only through FastAPI (AD-1), never the Data API.
alter table public.email_verifications enable row level security;
revoke all on table public.email_verifications from anon, authenticated;
