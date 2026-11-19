-- Phone upload: the hashed phone link, its batches, and their staged photos (Stories 6.1 + 6.2: FR-21,
-- AD-2, AD-5, AD-6, AD-12, AD-16, AD-24).
-- Only services/phone writes these tables, except `phone_batch_photos.unit_settled_at`, which
-- services/materials stamps while it processes or removes a finalized batch.

-- phone_upload_links: a short-lived, upload-only capability for one Project. The token itself is never
-- stored: only its SHA-256 hash (hex). Revoked when the QR dialog closes.
create table public.phone_upload_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (char_length(token_hash) = 64),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The owner, for scoping every query (AD-2); always the Project's account.
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index phone_upload_links_project_idx on public.phone_upload_links (project_id);

-- phone_batches: one "Send" from the phone. Finalizing turns it into one Study Material (`material_id`).
create table public.phone_batches (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.phone_upload_links (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  material_id uuid unique references public.study_materials (id) on delete set null
);

create index phone_batches_link_idx on public.phone_batches (link_id);

-- phone_batch_photos: one accepted photo, staged at
-- {account_id}/{project_id}/phone/{batch_id}/{photo_id} until its batch is processed or cleaned up.
-- `usage_day` is the day its reserved image unit counts toward (AD-12).
create table public.phone_batch_photos (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.phone_batches (id) on delete cascade,
  -- 0-based order of arrival; page n is position n - 1 among the accepted photos.
  position integer not null check (position >= 0),
  storage_path text not null,
  usage_day date not null,
  size_bytes bigint not null check (size_bytes >= 0),
  -- The cleaned file name and its type ('jpg', 'png', 'heic'): the type picks the decoder, and mock
  -- mode reads the outcome from the name (AD-4).
  file_name text not null check (char_length(file_name) between 1 and 255),
  file_type text not null check (file_type in ('jpg', 'png', 'heic')),
  -- When this photo's reserved image unit was settled: used (its vision call started) or given back
  -- (AD-12). Null means neither yet, so the unit is given back when the batch's job ends without it.
  unit_settled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (batch_id, position)
);

-- The browser reads app data only through FastAPI (AD-1), never the Data API.
alter table public.phone_upload_links enable row level security;
alter table public.phone_batches enable row level security;
alter table public.phone_batch_photos enable row level security;
revoke all on table public.phone_upload_links from anon, authenticated;
revoke all on table public.phone_batches from anon, authenticated;
revoke all on table public.phone_batch_photos from anon, authenticated;

-- A finalized phone batch is one Study Material of its own type.
alter table public.study_materials drop constraint study_materials_file_type_check;
alter table public.study_materials add constraint study_materials_file_type_check
  check (file_type in ('pdf', 'docx', 'pptx', 'txt', 'md', 'jpg', 'png', 'heic', 'phone_batch'));
