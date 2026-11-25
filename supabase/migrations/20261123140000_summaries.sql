-- Summaries and their sections (Story 4.3: FR-15, AD-7, AD-8, AD-16, AD-20).
-- Both tables are insert-only (AD-8): a summary and its sections are saved once, in the summary job's
-- save transaction. Nothing here is ever updated or regenerated in place.

-- summaries: one generated summary of one file, whole or narrowed to one of its Topics.
-- `generation_params` is the frozen scope the job ran from (material_id, topic_id, file_name,
-- section_ids, topic_labels; AD-7), so History (Epic 5) can show and reuse it unchanged.
create table public.summaries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The summary job that made it; one summary per job.
  job_id uuid unique references public.generation_jobs (id) on delete set null,
  generation_params jsonb not null,
  -- The model's title, in the material's language.
  title text not null check (char_length(title) >= 1),
  created_at timestamptz not null default now()
);

-- History (Epic 5) lists a Project's summaries newest first.
create index summaries_project_idx on public.summaries (project_id, created_at);

-- summary_sections: a heading and its text. Each cites at least one Section (AD-7).
create table public.summary_sections (
  id uuid primary key default gen_random_uuid(),
  summary_id uuid not null references public.summaries (id) on delete cascade,
  -- 0-based order within the summary; at most 8 sections.
  position integer not null check (position between 0 and 7),
  heading text not null check (char_length(heading) >= 1),
  text text not null check (char_length(text) >= 1),
  -- The Sections the section cites, and the Materials derived from them (AD-7 provenance).
  source_section_ids uuid[] not null check (cardinality(source_section_ids) >= 1),
  material_ids uuid[] not null check (cardinality(material_ids) >= 1),
  unique (summary_id, position)
);

-- The browser reads app data only through FastAPI (AD-1), never the Data API.
alter table public.summaries enable row level security;
alter table public.summary_sections enable row level security;
revoke all on table public.summaries from anon, authenticated;
revoke all on table public.summary_sections from anon, authenticated;
