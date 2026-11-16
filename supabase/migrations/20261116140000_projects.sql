-- projects: one row per Project, owned by one Account (FR-4, FR-5, AD-14, AD-22).
-- Every Project-owned table hangs off projects; deleting the profile cascades here.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  -- NULL until auto-named (Story 2.4) or renamed; the SPA shows the placeholder meanwhile (AD-14).
  name text check (name is null or char_length(name) between 1 and 100),
  -- Who set the name: 'auto' (once, from the first ready file) or 'student' (rename). NULL while unnamed.
  name_source text check (name_source is null or name_source in ('auto', 'student')),
  -- Read-only states (AD-22, Epic 7); require_active refuses content changes while either is set.
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  -- A name always has a source, and a source always has a name.
  check ((name is null) = (name_source is null))
);

-- Every lookup is scoped by account_id (AD-2); the Sidebar lists newest first.
create index projects_account_id_idx on public.projects (account_id, created_at desc);

-- The Project login lands on (FR-8); deleting that Project forgets it.
alter table public.profiles
  add constraint profiles_last_project_id_fkey
  foreign key (last_project_id) references public.projects (id) on delete set null;

-- The browser reads app data only through FastAPI (AD-1), never the Data API.
alter table public.projects enable row level security;
revoke all on table public.projects from anon, authenticated;
