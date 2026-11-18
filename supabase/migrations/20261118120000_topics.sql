-- Topics detected in each Study Material, and the Sections each one covers
-- (Story 2.6a: FR-22, AD-16, AD-21).

-- topics: a Material's Topics, in order. Saved in the processing job's save transaction with the
-- Sections and `ready` (AD-21). Only label, position, and group_label change later (Story 2.6b).
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.study_materials (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 100),
  -- A broader chapter or part the Topic sits under in the Topic list; null when ungrouped.
  group_label text check (group_label is null or char_length(group_label) between 1 and 100),
  -- 0-based order within the Material.
  position integer not null check (position >= 0),
  -- Detected by the server ('auto') or added by the student (Story 2.6b).
  origin text not null default 'auto' check (origin in ('auto', 'student')),
  unique (material_id, position)
);

-- topic_sections: which Sections each Topic covers; every Section of a Ready Material has at least one.
create table public.topic_sections (
  topic_id uuid not null references public.topics (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  primary key (topic_id, section_id)
);

-- Scope resolution (Epic 3) goes from a Section to its Topics.
create index topic_sections_section_idx on public.topic_sections (section_id);

-- The browser reads app data only through FastAPI (AD-1), never the Data API.
alter table public.topics enable row level security;
alter table public.topic_sections enable row level security;
revoke all on table public.topics from anon, authenticated;
revoke all on table public.topic_sections from anon, authenticated;
