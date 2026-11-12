-- profiles: one row per Account (AD-16, AD-19). Created idempotently by user_auth (AD-2 step 3).
-- Every app table hangs off profiles or projects; deleting the auth user cascades here.
create table public.profiles (
  account_id uuid primary key references auth.users (id) on delete cascade,
  -- Set from POST /api/auth/after-sign-in only while still NULL (Story 1.3).
  first_name text check (first_name is null or char_length(first_name) between 1 and 100),
  language text check (language is null or language in ('en', 'nb')),
  -- App-level email verification (AD-19); never gates normal use, only Google linking.
  email_verified_at timestamptz,
  -- Google takeover of an unverified email Account (AD-19, Story 1.6).
  google_takeover_at timestamptz,
  notice_google_takeover boolean not null default false,
  -- Panel and sidebar collapse state (PATCH /api/me/prefs).
  ui_prefs jsonb not null default '{}'::jsonb,
  -- The foreign key to projects is added with the projects table (Epic 2).
  last_project_id uuid,
  -- Privacy notice acknowledgment (FR-6, Epic 2).
  privacy_notice_ack_at timestamptz,
  created_at timestamptz not null default now()
);

-- The browser reads app data only through FastAPI (AD-1), never the Data API.
alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
