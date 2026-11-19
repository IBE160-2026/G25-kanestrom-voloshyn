-- Mistakes: wrong Quiz answers kept for review (Story 3.3: FR-9, FR-12, FR-20, AD-8, AD-10, AD-16).
-- Written only by `services/mistakes` (AD-10). A row is inserted when a wrong Quiz answer is saved; only
-- `cleared_at` (Story 3.5) and `withdrawn_at` (file removal with the opt-out) ever change afterwards.
-- Cleared and withdrawn rows stay as history and never count. The outstanding count is computed, never
-- stored.

create table public.mistakes (
  id uuid primary key default gen_random_uuid(),
  -- The owner, for scoping every query (AD-2).
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  quiz_question_id uuid not null references public.quiz_questions (id) on delete cascade,
  -- The wrong answer that made it.
  failed_answer_id uuid not null references public.quiz_answers (id) on delete cascade,
  -- Copied from the Question: the Materials it cites, so a file removal can withdraw it.
  material_ids uuid[] not null check (cardinality(material_ids) >= 1),
  -- The Question as shown: question, options, correct_option_id, explanation, source_section_ids.
  question_snapshot jsonb not null check (jsonb_typeof(question_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  cleared_at timestamptz,
  withdrawn_at timestamptz,
  -- A Mistake leaves review once: cleared or withdrawn, never both.
  check (cleared_at is null or withdrawn_at is null)
);

-- One outstanding Mistake per Question: a repeat failure while outstanding inserts nothing, and a
-- failure after clearing or withdrawing makes a new row (AD-10).
create unique index mistakes_outstanding_question_idx on public.mistakes (account_id, quiz_question_id)
  where cleared_at is null and withdrawn_at is null;

-- The outstanding count per Project (AD-10).
create index mistakes_project_outstanding_idx on public.mistakes (project_id)
  where cleared_at is null and withdrawn_at is null;

-- File removal finds the outstanding Mistakes citing a Material.
create index mistakes_material_ids_idx on public.mistakes using gin (material_ids);

-- The browser reads app data only through FastAPI (AD-1), never the Data API.
alter table public.mistakes enable row level security;
revoke all on table public.mistakes from anon, authenticated;
