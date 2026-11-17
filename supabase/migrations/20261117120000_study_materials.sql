-- Study Materials, their Sections, background jobs, and the private originals bucket
-- (Story 2.2: FR-6, FR-8, AD-5, AD-6, AD-16, AD-20, AD-23).

-- study_materials: one uploaded file in a Project. Only services/materials writes status (AD-5).
create table public.study_materials (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The owner, for scoping every query (AD-2); always the Project's account.
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  -- The file name as uploaded; kept for display, also after a rejection or removal (AD-5, AD-23).
  file_name text not null check (char_length(file_name) between 1 and 255),
  -- The format, from the extension. Images ('jpg', 'png', 'heic') arrive with Story 2.5.
  file_type text not null check (file_type in ('pdf', 'docx', 'pptx', 'txt', 'md', 'jpg', 'png', 'heic')),
  size_bytes bigint not null check (size_bytes >= 0),
  -- processing -> ready | rejected. Slot predicate: removed_at IS NULL AND status IN ('processing','ready').
  status text not null default 'processing' check (status in ('processing', 'ready', 'rejected')),
  -- Why a Material was rejected; a code the SPA translates (AD-6, AD-26).
  reject_reason text check (
    reject_reason is null or reject_reason in ('unreadable', 'unparseable', 'processing_failed', 'interrupted')
  ),
  -- Ready, partly unreadable (AD-6), and the 1-based pages or slides that couldn't be read.
  warning boolean not null default false,
  warning_pages integer[] not null default '{}',
  -- Set by removal (AD-23, Story 2.7); removed Materials never count or show.
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  -- A reason exactly when rejected.
  check ((status = 'rejected') = (reject_reason is not null))
);

-- The Files panel lists a Project's Materials oldest first; the slot count filters the same rows.
create index study_materials_project_idx on public.study_materials (project_id, created_at);

-- sections: the ordered text of a Material, one per page, slide, or ~500 words (AD-5).
create table public.sections (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.study_materials (id) on delete cascade,
  -- 0-based order within the Material.
  position integer not null check (position >= 0),
  -- What a source label shows, e.g. "Page 4" or "Slide 7: Mitosis".
  label text not null,
  -- Markdown text; emptied once when the Material is removed (AD-23).
  text text not null,
  -- Full-text index with the language-neutral 'simple' config; follows text automatically.
  tsv tsvector generated always as (to_tsvector('simple', text)) stored,
  unique (material_id, position)
);

create index sections_tsv_idx on public.sections using gin (tsv);

-- generation_jobs: in-process background work (AD-20). Only services/jobs writes this table.
create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('quiz', 'flashcards', 'summary', 'review_round', 'material_processing')),
  -- The setup the job runs from; a retry creates a new job from the same params.
  params jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress_step text check (progress_step is null or progress_step in ('reading', 'writing', 'checking')),
  cancel_requested boolean not null default false,
  -- The row the job produced or worked on (for material_processing, the Material).
  result_ref uuid,
  -- Why the job failed, e.g. 'interrupted' or 'processing_failed'.
  error_code text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  -- When the SPA dismissed the finished job (POST /api/jobs/{id}/seen).
  seen_at timestamptz
);

-- Polling reads a Project's active and finished-unseen jobs; the restart sweep reads active ones.
create index generation_jobs_project_idx on public.generation_jobs (project_id, created_at);
create index generation_jobs_active_idx on public.generation_jobs (status) where status in ('queued', 'running');

-- The browser reads app data only through FastAPI (AD-1), never the Data API.
alter table public.study_materials enable row level security;
alter table public.sections enable row level security;
alter table public.generation_jobs enable row level security;
revoke all on table public.study_materials from anon, authenticated;
revoke all on table public.sections from anon, authenticated;
revoke all on table public.generation_jobs from anon, authenticated;

-- The private bucket for originals (AD-16), read and written only by backend/app/storage.py with the
-- secret key at {account_id}/{project_id}/{material_id}/original. No storage.objects policy grants
-- anon or authenticated anything, so the browser keys can't list, read, or write it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('study-materials', 'study-materials', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
