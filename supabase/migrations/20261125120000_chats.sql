-- Chats and their messages (Story 4.4: FR-16, AD-7, AD-8, AD-12, AD-16, AD-18, AD-25).
-- `chat_messages` is insert-only (AD-8): a question and its answer are saved together, once, after the
-- answer has streamed to completion. On `chats`, only `current_scope` and `last_opened_at` ever change.

-- chats: one conversation in a Project (Story 4.4 keeps one per Project; Story 4.5 adds more).
-- `current_scope` is what the next message is answered from: {"all_materials": true} or
-- {"material_id": "<uuid>"}.
create table public.chats (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  current_scope jsonb not null default '{"all_materials": true}'::jsonb,
  created_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now()
);

create index chats_project_idx on public.chats (project_id);

-- chat_messages: the student's question or the answer, numbered by `seq` within the chat. `seq` is
-- assigned under a lock on the chat row (AD-25). Each message keeps the scope it was asked under.
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  seq integer not null check (seq >= 1),
  role text not null check (role in ('user', 'assistant')),
  scope jsonb not null,
  text text not null check (char_length(text) >= 1),
  -- The Sections an answer cites, and the Materials derived from them (AD-7 provenance). Empty for a
  -- question, and for an answer the material doesn't cover.
  source_section_ids uuid[] not null default '{}',
  material_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  -- Also the (chat_id, seq) index the thread is read by.
  unique (chat_id, seq)
);

-- The browser reads app data only through FastAPI (AD-1), never the Data API.
alter table public.chats enable row level security;
alter table public.chat_messages enable row level security;
revoke all on table public.chats from anon, authenticated;
revoke all on table public.chat_messages from anon, authenticated;
