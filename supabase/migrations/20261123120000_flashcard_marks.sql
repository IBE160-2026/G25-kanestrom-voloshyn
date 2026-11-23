-- Flashcard marks (Story 4.2: FR-14, AD-8, AD-16, AD-22, AD-27).
-- Insert-only (AD-8): each "Got it" or "Not yet" is one row, never updated. The study session (the
-- queue of remaining cards, the cards done, the cards that needed a second try) is derived from these
-- rows; the set's one mutable column stays `flashcard_sets.ended_at`. Marks never create a Mistake.

create table public.flashcard_marks (
  -- Ordered by `id`: the queue puts "Not yet" cards back by their latest "Not yet" mark, oldest first.
  id bigint generated always as identity primary key,
  set_id uuid not null references public.flashcard_sets (id) on delete cascade,
  card_id uuid not null references public.flashcards (id) on delete cascade,
  mark text not null check (mark in ('got_it', 'not_yet')),
  -- The last mark's time ends a set left idle for 30 minutes.
  created_at timestamptz not null default now()
);

-- A card is "Got it" at most once: a repeat returns the current state and saves nothing.
create unique index flashcard_marks_got_it_once on public.flashcard_marks (card_id) where mark = 'got_it';

-- Deleting a card (Project purge, account delete) cascades here by `card_id`.
create index flashcard_marks_card_idx on public.flashcard_marks (card_id);

-- A set's marks are read in order.
create index flashcard_marks_set_idx on public.flashcard_marks (set_id, id);

-- The browser reads app data only through FastAPI (AD-1), never the Data API.
alter table public.flashcard_marks enable row level security;
revoke all on table public.flashcard_marks from anon, authenticated;
