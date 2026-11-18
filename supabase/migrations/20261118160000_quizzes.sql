-- Quizzes and their Questions (Story 3.1a: FR-10, FR-26, AD-7, AD-8, AD-9, AD-16, AD-20).
-- Both tables are insert-only (AD-8): a Quiz and its Questions are saved once, in the quiz job's save
-- transaction, and never updated.

-- quizzes: one generated Quiz. `generation_params` is the frozen scope the job ran from
-- (count, section_ids, topic_labels; AD-7), so "Do it again" (Epic 5) can reuse it unchanged.
create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The quiz job that made it; one Quiz per job.
  job_id uuid unique references public.generation_jobs (id) on delete set null,
  generation_params jsonb not null,
  -- The count frozen at request time: what was asked for (5, 10, or 20), cut to what the scope
  -- supports. The Quiz may still hold fewer Questions ("only {n} were possible").
  requested_count integer not null check (requested_count between 1 and 20),
  created_at timestamptz not null default now()
);

-- History (Epic 5) lists a Project's Quizzes newest first.
create index quizzes_project_idx on public.quizzes (project_id, created_at);

-- quiz_questions: 4-option multiple choice (AD-9). Options are [{id: 'a'..'d', text}], shuffled by the
-- service; `correct_option_id` names one of them. Each cites at least one Section (AD-7).
create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  -- 0-based order within the Quiz; at most 20 Questions (AD-12).
  position integer not null check (position between 0 and 19),
  question text not null check (char_length(question) >= 1),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  correct_option_id text not null check (correct_option_id in ('a', 'b', 'c', 'd')),
  explanation text not null check (char_length(explanation) >= 1),
  -- The Sections the Question cites, and the Materials derived from them (AD-7 provenance).
  source_section_ids uuid[] not null check (cardinality(source_section_ids) >= 1),
  material_ids uuid[] not null check (cardinality(material_ids) >= 1),
  unique (quiz_id, position)
);

-- The browser reads app data only through FastAPI (AD-1), never the Data API.
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
revoke all on table public.quizzes from anon, authenticated;
revoke all on table public.quiz_questions from anon, authenticated;
