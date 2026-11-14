alter table public.jobs
  add column created_at timestamptz not null default now();
