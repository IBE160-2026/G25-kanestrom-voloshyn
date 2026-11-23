-- Flashcard Sets and their Cards (Story 4.1: FR-13, AD-7, AD-8, AD-16, AD-20).
-- Both tables are insert-only (AD-8): a set and its cards are saved once, in the flashcards job's save
-- transaction. The one mutable column is `flashcard_sets.ended_at` (Story 4.2). Marks come with 4.2.

-- flashcard_sets: one generated set. `generation_params` is the frozen scope the job ran from
-- (count, section_ids, topic_labels; AD-7), so "Do it again" (Epic 5) can reuse it unchanged.
create table public.flashcard_sets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The flashcards job that made it; one set per job.
  job_id uuid unique references public.generation_jobs (id) on delete set null,
  generation_params jsonb not null,
  -- The count frozen at request time: what was asked for (5, 10, or 20), cut to what the scope
  -- supports. The set may still hold fewer cards ("only {n} were possible").
  requested_count integer not null check (requested_count between 1 and 20),
  created_at timestamptz not null default now(),
  -- Set when the student opens another set or leaves it idle (Story 4.2); null while open.
  ended_at timestamptz
);

-- History (Epic 5) lists a Project's sets newest first.
create index flashcard_sets_project_idx on public.flashcard_sets (project_id, created_at);

-- flashcards: a question and its answer. Each cites at least one Section (AD-7).
create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.flashcard_sets (id) on delete cascade,
  -- 0-based order within the set; at most 20 cards (AD-12).
  position integer not null check (position between 0 and 19),
  question text not null check (char_length(question) >= 1),
  answer text not null check (char_length(answer) >= 1),
  -- The Sections the card cites, and the Materials derived from them (AD-7 provenance).
  source_section_ids uuid[] not null check (cardinality(source_section_ids) >= 1),
  material_ids uuid[] not null check (cardinality(material_ids) >= 1),
  unique (set_id, position)
);

-- The browser reads app data only through FastAPI (AD-1), never the Data API.
alter table public.flashcard_sets enable row level security;
alter table public.flashcards enable row level security;
revoke all on table public.flashcard_sets from anon, authenticated;
revoke all on table public.flashcards from anon, authenticated;
