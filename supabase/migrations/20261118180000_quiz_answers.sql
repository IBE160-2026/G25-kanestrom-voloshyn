-- Answers to Quiz Questions (Story 3.2: FR-11, AD-8, AD-9, AD-16).
-- Insert-only (AD-8): one answer per Question, saved once when the student picks an option and never
-- updated. One attempt per Quiz; a resubmit returns the stored row (idempotent on `quiz_question_id`).

create table public.quiz_answers (
  id uuid primary key default gen_random_uuid(),
  -- One answer per Question.
  quiz_question_id uuid not null unique references public.quiz_questions (id) on delete cascade,
  -- The owner, for scoping every query (AD-2).
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  submitted_option_id text not null check (submitted_option_id in ('a', 'b', 'c', 'd')),
  -- Scored in the backend as submitted_option_id = correct_option_id, with no AI call (AD-9).
  is_correct boolean not null,
  created_at timestamptz not null default now()
);

-- Answers are read per Account (AD-2).
create index quiz_answers_account_idx on public.quiz_answers (account_id);

-- The browser reads app data only through FastAPI (AD-1), never the Data API.
alter table public.quiz_answers enable row level security;
revoke all on table public.quiz_answers from anon, authenticated;
