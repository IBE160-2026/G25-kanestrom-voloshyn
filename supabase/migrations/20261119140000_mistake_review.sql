-- Mistake Review: rounds, Practice Questions, and their answers (Stories 3.4 + 3.5: FR-17, FR-18, AD-8,
-- AD-9, AD-10, AD-11, AD-16, AD-20).
-- Every table here is insert-only (AD-8). A round is made by a student's request (a `review_rounds` row
-- and a `review_round` job); the job saves its Practice Questions and `round_items` once. Answers are
-- saved once per Practice Question. Clearing a Mistake stamps `mistakes.cleared_at` and links the
-- correct Practice answer through `services/mistakes` only (AD-10).

-- review_rounds: one round per request. `job_id` is the `review_round` job that fills it.
create table public.review_rounds (
  id uuid primary key default gen_random_uuid(),
  -- The owner, for scoping every query (AD-2).
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  job_id uuid unique references public.generation_jobs (id) on delete set null,
  created_at timestamptz not null default now()
);

create index review_rounds_project_idx on public.review_rounds (project_id, created_at);

-- practice_questions: a 4-option question (AD-9) targeting one Mistake. `from_original` marks the saved
-- original Quiz question served again, re-shuffled, because a cited file was removed (AD-11).
create table public.practice_questions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  mistake_id uuid not null references public.mistakes (id) on delete cascade,
  question text not null check (char_length(question) >= 1),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  correct_option_id text not null check (correct_option_id in ('a', 'b', 'c', 'd')),
  explanation text not null check (char_length(explanation) >= 1),
  -- The Sections it cites and the Materials derived from them (AD-7 provenance).
  source_section_ids uuid[] not null check (cardinality(source_section_ids) >= 1),
  material_ids uuid[] not null check (cardinality(material_ids) >= 1),
  from_original boolean not null default false,
  created_at timestamptz not null default now()
);

-- A round's job finds a Mistake's unanswered Practice Question from an earlier round.
create index practice_questions_mistake_idx on public.practice_questions (mistake_id);

-- round_items: which Practice Questions a round holds, in Mistake age order. An unanswered Practice
-- Question moves into a later round as a new item, without being rewritten.
create table public.round_items (
  round_id uuid not null references public.review_rounds (id) on delete cascade,
  practice_question_id uuid not null references public.practice_questions (id) on delete cascade,
  -- 0-based; at most 20 items per round (AD-12).
  position integer not null check (position between 0 and 19),
  primary key (round_id, practice_question_id),
  unique (round_id, position)
);

create index round_items_practice_question_idx on public.round_items (practice_question_id);

-- practice_answers: one answer per Practice Question, scored in the backend (AD-9) and never updated.
-- A practice answer never creates a Mistake (AD-10).
create table public.practice_answers (
  id uuid primary key default gen_random_uuid(),
  practice_question_id uuid not null unique references public.practice_questions (id) on delete cascade,
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  submitted_option_id text not null check (submitted_option_id in ('a', 'b', 'c', 'd')),
  is_correct boolean not null,
  created_at timestamptz not null default now()
);

create index practice_answers_account_idx on public.practice_answers (account_id);

-- The correct Practice answer that cleared a Mistake; set together with `cleared_at`.
alter table public.mistakes
  add column cleared_by_answer_id uuid references public.practice_answers (id) on delete set null,
  add constraint mistakes_cleared_by_answer_check check (cleared_by_answer_id is null or cleared_at is not null);

-- One Practice answer clears at most one Mistake.
create unique index mistakes_cleared_by_answer_idx on public.mistakes (cleared_by_answer_id)
  where cleared_by_answer_id is not null;

-- One queued or running `review_round` job per Project: a second request gets `409 review_in_progress`
-- (AD-11).
create unique index generation_jobs_one_review_round_idx on public.generation_jobs (project_id)
  where kind = 'review_round' and status in ('queued', 'running');

-- The browser reads app data only through FastAPI (AD-1), never the Data API.
alter table public.review_rounds enable row level security;
alter table public.practice_questions enable row level security;
alter table public.round_items enable row level security;
alter table public.practice_answers enable row level security;
revoke all on table public.review_rounds from anon, authenticated;
revoke all on table public.practice_questions from anon, authenticated;
revoke all on table public.round_items from anon, authenticated;
revoke all on table public.practice_answers from anon, authenticated;
