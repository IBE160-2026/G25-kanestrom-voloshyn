-- Daily usage counters for the server-enforced limits, and the vision-call marker on jobs
-- (Story 2.5: FR-7, AD-12, AD-20).

-- usage_counters: units used per Account, calendar day (in QUOTA_TIMEZONE), and kind. Only
-- services/usage reads or writes it: one atomic upsert reserves a unit while `count` is under the
-- limit, and a release gives one back, never below 0. Epic 4's chat limit ('ask_ai_message') reuses it.
create table public.usage_counters (
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  -- The calendar day the unit counts toward, in QUOTA_TIMEZONE (default Europe/Oslo).
  usage_day date not null,
  kind text not null check (kind in ('image_extraction', 'ask_ai_message')),
  count integer not null default 0 check (count >= 0),
  primary key (account_id, usage_day, kind)
);

-- The browser reads app data only through FastAPI (AD-1), never the Data API.
alter table public.usage_counters enable row level security;
revoke all on table public.usage_counters from anon, authenticated;

-- When a material_processing job for an image started its vision call; set only by services/jobs.
-- Null means the call never started, so the image's reserved unit is given back when the job ends.
alter table public.generation_jobs add column vision_started_at timestamptz;
