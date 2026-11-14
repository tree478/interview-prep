-- B-1: schema, RLS, @umass.edu auth trigger, private resumes bucket,
-- company_engagement_counts(), and the skills seed.
--
-- Not in PRD §7.2, included because the contracts need them:
--   skills.whole_word_case_sensitive  (data/skills.json flags C, R, and Go)
--   matches.preferred_covered, matches.preferred_missing, matches.hard_mismatch
--     (TASKS.md §2 MatchResult; MATCH-4 / MATCH-6)

-- ---------------------------------------------------------------------------
-- Tables. bot_runs is created before jobs because jobs.ingested_by_run_id
-- references it. profiles.user_id and company_briefs.company are the only
-- primary keys that are not uuids.
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null,
  year text,
  majors text[] not null default '{}',
  minors text[] not null default '{}',
  honors text[] not null default '{}',
  clubs jsonb not null default '[]',
  skills text[] not null default '{}',
  interests text[] not null default '{}',
  needs_sponsorship boolean not null default false,
  open_to_relocation boolean not null default false,
  preferred_locations text[] not null default '{}',
  min_pay numeric,
  constraint profiles_interests_max_10 check (cardinality(interests) <= 10)
);

create table public.experiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company text not null,
  position text not null,
  start_date date,
  end_date date,
  bullets text[] not null default '{}',
  skills text[] not null default '{}'
);

create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text,
  raw_text text,
  parsed_json jsonb,
  ats_report jsonb,
  uploaded_at timestamptz not null default now()
);

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  aliases text[] not null default '{}',
  category text not null,
  -- Not in PRD §7.2. data/skills.json has this flag for C, R, and Go.
  whole_word_case_sensitive boolean not null default false
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source text not null,
  slug text not null,
  active boolean not null default true,
  last_checked_at timestamptz,
  last_postings_found integer,
  constraint companies_source_check check (source in ('greenhouse', 'lever')),
  constraint companies_source_slug_key unique (source, slug)
);

create table public.bot_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null,
  kind text not null,
  status text not null default 'running',
  companies_selected jsonb not null default '[]',
  companies_checked integer not null default 0,
  jobs_added integer not null default 0,
  jobs_extracted integer not null default 0,
  briefs_written integer not null default 0,
  course_stats jsonb,
  errors jsonb not null default '[]',
  constraint bot_runs_trigger_check check (trigger in ('cron', 'manual')),
  constraint bot_runs_kind_check check (kind in ('scout', 'courses')),
  constraint bot_runs_status_check check (status in ('running', 'done', 'failed'))
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  company text not null,
  title text not null,
  location text,
  url text not null,
  description text,
  posted_at timestamptz,
  deadline date,
  extracted_json jsonb,
  extraction_status text not null default 'pending',
  dropped_skills text[] not null default '{}',
  ingested_by_run_id uuid references public.bot_runs (id) on delete set null,
  role_type text,
  extraction_attempts integer not null default 0,
  constraint jobs_source_check check (source in ('greenhouse', 'lever')),
  constraint jobs_extraction_status_check check (extraction_status in ('pending', 'done', 'failed')),
  constraint jobs_role_type_check check (role_type in ('internship', 'new_grad', 'other')),
  constraint jobs_source_external_id_key unique (source, external_id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  -- Null score means N/A (MATCH-6): the posting listed no required skills.
  score numeric,
  covered_skills text[] not null default '{}',
  missing_skills text[] not null default '{}',
  -- Not in PRD §7.2. TASKS.md §2 MatchResult needs these three.
  preferred_covered text[] not null default '{}',
  preferred_missing text[] not null default '{}',
  hard_mismatch text,
  requirement_checks jsonb not null default '[]',
  computed_at timestamptz not null default now(),
  constraint matches_user_job_key unique (user_id, job_id)
);

create table public.umass_resources (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  name text not null,
  url text not null,
  skills text[] not null default '{}',
  description text,
  meta jsonb not null default '{}',
  source_url text,
  content_hash text,
  active boolean not null default true,
  last_checked_at timestamptz,
  constraint umass_resources_type_check check (type in ('course', 'lab')),
  constraint umass_resources_type_name_key unique (type, name)
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  stage text not null default 'saved',
  deadline date,
  deadline_source text,
  notes text,
  updated_at timestamptz not null default now(),
  constraint applications_stage_check check (stage in ('saved', 'applied', 'interviewing', 'offer')),
  constraint applications_deadline_source_check check (deadline_source in ('user', 'posting')),
  constraint applications_user_job_key unique (user_id, job_id)
);

create table public.tailorings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  resume_id uuid not null references public.resumes (id) on delete cascade,
  bullet_diffs jsonb not null default '[]',
  rejected_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  questions jsonb,
  answers jsonb,
  feedback jsonb,
  created_at timestamptz not null default now()
);

create table public.company_briefs (
  company text primary key,
  summary text,
  talking_points text[] not null default '{}',
  generated_at timestamptz not null default now()
);

create index experiences_user_id_idx on public.experiences (user_id);
create index resumes_user_id_idx on public.resumes (user_id);
create index tailorings_user_id_idx on public.tailorings (user_id);
create index interview_sessions_user_id_idx on public.interview_sessions (user_id);
create index jobs_company_idx on public.jobs (company);
create index jobs_ingested_by_run_id_idx on public.jobs (ingested_by_run_id);

-- ---------------------------------------------------------------------------
-- RLS. User tables: authenticated CRUD where auth.uid() = user_id.
-- Shared tables: authenticated SELECT only. No anon policies.
-- The service role bypasses RLS and is the only writer of shared tables.
-- ---------------------------------------------------------------------------

-- profiles: the signed-in user may read and write only their own rows.
alter table public.profiles enable row level security;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy profiles_delete_own
  on public.profiles
  for delete
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.profiles from public, anon, authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

-- experiences: the signed-in user may read and write only their own rows.
alter table public.experiences enable row level security;

create policy experiences_select_own
  on public.experiences
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy experiences_insert_own
  on public.experiences
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy experiences_update_own
  on public.experiences
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy experiences_delete_own
  on public.experiences
  for delete
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.experiences from public, anon, authenticated;
grant select, insert, update, delete on table public.experiences to authenticated;
grant select, insert, update, delete on table public.experiences to service_role;

-- resumes: the signed-in user may read and write only their own rows.
alter table public.resumes enable row level security;

create policy resumes_select_own
  on public.resumes
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy resumes_insert_own
  on public.resumes
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy resumes_update_own
  on public.resumes
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy resumes_delete_own
  on public.resumes
  for delete
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.resumes from public, anon, authenticated;
grant select, insert, update, delete on table public.resumes to authenticated;
grant select, insert, update, delete on table public.resumes to service_role;

-- matches: the signed-in user may read and write only their own rows.
alter table public.matches enable row level security;

create policy matches_select_own
  on public.matches
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy matches_insert_own
  on public.matches
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy matches_update_own
  on public.matches
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy matches_delete_own
  on public.matches
  for delete
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.matches from public, anon, authenticated;
grant select, insert, update, delete on table public.matches to authenticated;
grant select, insert, update, delete on table public.matches to service_role;

-- applications: the signed-in user may read and write only their own rows.
alter table public.applications enable row level security;

create policy applications_select_own
  on public.applications
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy applications_insert_own
  on public.applications
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy applications_update_own
  on public.applications
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy applications_delete_own
  on public.applications
  for delete
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.applications from public, anon, authenticated;
grant select, insert, update, delete on table public.applications to authenticated;
grant select, insert, update, delete on table public.applications to service_role;

-- tailorings: the signed-in user may read and write only their own rows.
alter table public.tailorings enable row level security;

create policy tailorings_select_own
  on public.tailorings
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy tailorings_insert_own
  on public.tailorings
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy tailorings_update_own
  on public.tailorings
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy tailorings_delete_own
  on public.tailorings
  for delete
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.tailorings from public, anon, authenticated;
grant select, insert, update, delete on table public.tailorings to authenticated;
grant select, insert, update, delete on table public.tailorings to service_role;

-- interview_sessions: the signed-in user may read and write only their own rows.
alter table public.interview_sessions enable row level security;

create policy interview_sessions_select_own
  on public.interview_sessions
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy interview_sessions_insert_own
  on public.interview_sessions
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy interview_sessions_update_own
  on public.interview_sessions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy interview_sessions_delete_own
  on public.interview_sessions
  for delete
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.interview_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.interview_sessions to authenticated;
grant select, insert, update, delete on table public.interview_sessions to service_role;

-- jobs: authenticated read. Service role is the only writer (RLS has no write policy).
alter table public.jobs enable row level security;

create policy jobs_select_authenticated
  on public.jobs
  for select
  to authenticated
  using (true);

revoke all on table public.jobs from public, anon, authenticated;
grant select on table public.jobs to authenticated;
grant select, insert, update, delete on table public.jobs to service_role;

-- companies: authenticated read. Service role is the only writer (RLS has no write policy).
alter table public.companies enable row level security;

create policy companies_select_authenticated
  on public.companies
  for select
  to authenticated
  using (true);

revoke all on table public.companies from public, anon, authenticated;
grant select on table public.companies to authenticated;
grant select, insert, update, delete on table public.companies to service_role;

-- skills: authenticated read. Service role is the only writer (RLS has no write policy).
alter table public.skills enable row level security;

create policy skills_select_authenticated
  on public.skills
  for select
  to authenticated
  using (true);

revoke all on table public.skills from public, anon, authenticated;
grant select on table public.skills to authenticated;
grant select, insert, update, delete on table public.skills to service_role;

-- umass_resources: authenticated read. Service role is the only writer (RLS has no write policy).
alter table public.umass_resources enable row level security;

create policy umass_resources_select_authenticated
  on public.umass_resources
  for select
  to authenticated
  using (true);

revoke all on table public.umass_resources from public, anon, authenticated;
grant select on table public.umass_resources to authenticated;
grant select, insert, update, delete on table public.umass_resources to service_role;

-- bot_runs: authenticated read. Service role is the only writer (RLS has no write policy).
alter table public.bot_runs enable row level security;

create policy bot_runs_select_authenticated
  on public.bot_runs
  for select
  to authenticated
  using (true);

revoke all on table public.bot_runs from public, anon, authenticated;
grant select on table public.bot_runs to authenticated;
grant select, insert, update, delete on table public.bot_runs to service_role;

-- company_briefs: authenticated read. Service role is the only writer (RLS has no write policy).
alter table public.company_briefs enable row level security;

create policy company_briefs_select_authenticated
  on public.company_briefs
  for select
  to authenticated
  using (true);

revoke all on table public.company_briefs from public, anon, authenticated;
grant select on table public.company_briefs to authenticated;
grant select, insert, update, delete on table public.company_briefs to service_role;

-- ---------------------------------------------------------------------------
-- AUTH-1. Reject any signup whose email is null or does not end in
-- @umass.edu (case-insensitive). Otherwise create the profile row.
-- security definer so the insert succeeds before a session exists.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null or new.email !~* '@umass\.edu$' then
    raise exception 'Only @umass.edu email addresses can sign up';
  end if;

  insert into public.profiles (user_id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Private resumes bucket. A user can only touch objects under their own folder.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do update set public = false, name = excluded.name;

alter table storage.objects enable row level security;

create policy resumes_objects_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy resumes_objects_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy resumes_objects_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy resumes_objects_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- JOB-3a. Per-company save and application counts. No user ids.
-- saves = stage 'saved'. applications = applied, interviewing, or offer.
-- Companies that have jobs but no tracker rows are returned with zeros.
-- ---------------------------------------------------------------------------

create or replace function public.company_engagement_counts()
returns table (company text, saves bigint, applications bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    j.company,
    count(*) filter (where a.stage = 'saved') as saves,
    count(*) filter (where a.stage in ('applied', 'interviewing', 'offer')) as applications
  from public.jobs j
  left join public.applications a on a.job_id = j.id
  group by j.company;
$$;

revoke all on function public.company_engagement_counts() from public, anon, authenticated;
grant execute on function public.company_engagement_counts() to service_role;

-- ---------------------------------------------------------------------------
-- Skills seed from data/skills.json (C-1). Do not edit that file.
-- whole_word_case_sensitive is true only for C, R, and Go.
--
-- B-2 must whole-word, case-sensitive match those three.
-- B-2 should also whole-word match the short aliases that are NOT flagged:
--   CV (Computer vision), OS (Operating systems), TS (TypeScript),
--   TF (TensorFlow), ML (Machine learning), RL (Reinforcement learning),
--   UX (UI/UX design).
-- Do not let the GitHub alias of Git swallow "GitHub Actions" (an alias of CI/CD).
-- ---------------------------------------------------------------------------

insert into public.skills (canonical_name, aliases, category, whole_word_case_sensitive)
values
  ('Python', array['py', 'python3']::text[], 'Languages', false),
  ('Java', '{}'::text[], 'Languages', false),
  ('JavaScript', array['JS', 'ECMAScript', 'ES6']::text[], 'Languages', false),
  ('TypeScript', array['TS']::text[], 'Languages', false),
  ('C', '{}'::text[], 'Languages', true),
  ('C++', array['cpp']::text[], 'Languages', false),
  ('C#', array['csharp']::text[], 'Languages', false),
  ('Go', array['Golang']::text[], 'Languages', true),
  ('Rust', '{}'::text[], 'Languages', false),
  ('Kotlin', '{}'::text[], 'Languages', false),
  ('Swift', '{}'::text[], 'Languages', false),
  ('R', '{}'::text[], 'Languages', true),
  ('MATLAB', '{}'::text[], 'Languages', false),
  ('SQL', '{}'::text[], 'Languages', false),
  ('Bash', array['shell', 'shell scripting']::text[], 'Languages', false),
  ('Scala', '{}'::text[], 'Languages', false),
  ('Ruby', '{}'::text[], 'Languages', false),
  ('PHP', '{}'::text[], 'Languages', false),
  ('HTML', array['HTML5']::text[], 'Frontend and mobile', false),
  ('CSS', array['CSS3', 'Sass', 'SCSS']::text[], 'Frontend and mobile', false),
  ('React', array['React.js', 'ReactJS']::text[], 'Frontend and mobile', false),
  ('Next.js', array['NextJS']::text[], 'Frontend and mobile', false),
  ('Angular', array['AngularJS']::text[], 'Frontend and mobile', false),
  ('Vue', array['Vue.js']::text[], 'Frontend and mobile', false),
  ('Tailwind CSS', array['Tailwind']::text[], 'Frontend and mobile', false),
  ('Redux', '{}'::text[], 'Frontend and mobile', false),
  ('React Native', '{}'::text[], 'Frontend and mobile', false),
  ('iOS development', array['iOS', 'UIKit', 'SwiftUI']::text[], 'Frontend and mobile', false),
  ('Android development', array['Android SDK', 'Jetpack Compose']::text[], 'Frontend and mobile', false),
  ('Node.js', array['Node', 'NodeJS']::text[], 'Backend', false),
  ('Express', array['Express.js']::text[], 'Backend', false),
  ('Django', '{}'::text[], 'Backend', false),
  ('Flask', '{}'::text[], 'Backend', false),
  ('FastAPI', '{}'::text[], 'Backend', false),
  ('Spring', array['Spring Boot']::text[], 'Backend', false),
  ('Ruby on Rails', array['Rails']::text[], 'Backend', false),
  ('REST APIs', array['REST', 'RESTful']::text[], 'Backend', false),
  ('GraphQL', '{}'::text[], 'Backend', false),
  ('gRPC', '{}'::text[], 'Backend', false),
  ('Microservices', '{}'::text[], 'Backend', false),
  ('PostgreSQL', array['Postgres']::text[], 'Databases', false),
  ('MySQL', '{}'::text[], 'Databases', false),
  ('SQLite', '{}'::text[], 'Databases', false),
  ('MongoDB', array['Mongo']::text[], 'Databases', false),
  ('Redis', '{}'::text[], 'Databases', false),
  ('DynamoDB', '{}'::text[], 'Databases', false),
  ('Snowflake', '{}'::text[], 'Databases', false),
  ('BigQuery', '{}'::text[], 'Databases', false),
  ('Database systems', array['database design', 'data modeling']::text[], 'Databases', false),
  ('Machine learning', array['ML']::text[], 'Data and ML', false),
  ('Deep learning', array['neural networks']::text[], 'Data and ML', false),
  ('PyTorch', array['Torch']::text[], 'Data and ML', false),
  ('TensorFlow', array['TF', 'Keras']::text[], 'Data and ML', false),
  ('scikit-learn', array['sklearn']::text[], 'Data and ML', false),
  ('pandas', '{}'::text[], 'Data and ML', false),
  ('NumPy', '{}'::text[], 'Data and ML', false),
  ('Natural language processing', array['NLP']::text[], 'Data and ML', false),
  ('Computer vision', array['CV']::text[], 'Data and ML', false),
  ('Large language models', array['LLMs', 'generative AI', 'GenAI']::text[], 'Data and ML', false),
  ('Reinforcement learning', array['RL']::text[], 'Data and ML', false),
  ('Statistics', array['statistical analysis', 'probability']::text[], 'Data and ML', false),
  ('Data analysis', array['data analytics']::text[], 'Data and ML', false),
  ('Data visualization', array['matplotlib', 'seaborn']::text[], 'Data and ML', false),
  ('Apache Spark', array['Spark', 'PySpark']::text[], 'Data and ML', false),
  ('Jupyter', array['Jupyter Notebook']::text[], 'Data and ML', false),
  ('AWS', array['Amazon Web Services', 'EC2', 'S3', 'Lambda']::text[], 'Cloud and DevOps', false),
  ('Google Cloud', array['GCP']::text[], 'Cloud and DevOps', false),
  ('Microsoft Azure', array['Azure']::text[], 'Cloud and DevOps', false),
  ('Docker', array['containers', 'containerization']::text[], 'Cloud and DevOps', false),
  ('Kubernetes', array['K8s']::text[], 'Cloud and DevOps', false),
  ('CI/CD', array['continuous integration', 'GitHub Actions', 'Jenkins']::text[], 'Cloud and DevOps', false),
  ('Terraform', array['infrastructure as code', 'IaC']::text[], 'Cloud and DevOps', false),
  ('Linux', array['Unix']::text[], 'Cloud and DevOps', false),
  ('Git', array['GitHub', 'GitLab', 'version control']::text[], 'Cloud and DevOps', false),
  ('Data structures', '{}'::text[], 'CS fundamentals', false),
  ('Algorithms', '{}'::text[], 'CS fundamentals', false),
  ('Object-oriented programming', array['OOP']::text[], 'CS fundamentals', false),
  ('Operating systems', array['OS']::text[], 'CS fundamentals', false),
  ('Computer networks', array['networking', 'TCP/IP']::text[], 'CS fundamentals', false),
  ('Distributed systems', '{}'::text[], 'CS fundamentals', false),
  ('Computer architecture', '{}'::text[], 'CS fundamentals', false),
  ('Compilers', '{}'::text[], 'CS fundamentals', false),
  ('Concurrency', array['multithreading', 'parallel programming']::text[], 'CS fundamentals', false),
  ('Cybersecurity', array['security', 'information security']::text[], 'CS fundamentals', false),
  ('Cryptography', '{}'::text[], 'CS fundamentals', false),
  ('Embedded systems', array['firmware', 'microcontrollers', 'Arduino']::text[], 'CS fundamentals', false),
  ('Human-computer interaction', array['HCI']::text[], 'CS fundamentals', false),
  ('Software engineering', array['SDLC']::text[], 'Engineering practice', false),
  ('Testing', array['unit testing', 'Jest', 'pytest', 'JUnit']::text[], 'Engineering practice', false),
  ('Agile', array['Scrum']::text[], 'Engineering practice', false),
  ('Code review', '{}'::text[], 'Engineering practice', false),
  ('API design', '{}'::text[], 'Engineering practice', false),
  ('Figma', '{}'::text[], 'Design and analytics tools', false),
  ('UI/UX design', array['UX', 'UI design', 'user experience']::text[], 'Design and analytics tools', false),
  ('Excel', array['Microsoft Excel', 'spreadsheets']::text[], 'Design and analytics tools', false),
  ('Tableau', '{}'::text[], 'Design and analytics tools', false),
  ('Power BI', '{}'::text[], 'Design and analytics tools', false);

do $$
begin
  if (select count(*) from public.skills) <> 97 then
    raise exception 'skills seed: expected 97 rows, found %', (select count(*) from public.skills);
  end if;

  if (
    select count(*)
    from public.skills
    where canonical_name in ('C', 'R', 'Go')
      and whole_word_case_sensitive
  ) <> 3 then
    raise exception 'skills seed: C, R, and Go must be the flagged whole-word skills';
  end if;

  if (select count(*) from public.skills where whole_word_case_sensitive) <> 3 then
    raise exception 'skills seed: only C, R, and Go may set whole_word_case_sensitive';
  end if;

  if not exists (
    select 1 from public.skills
    where canonical_name = 'Git'
      and 'GitHub' = any (aliases)
  ) then
    raise exception 'skills seed: Git must keep the GitHub alias';
  end if;

  if not exists (
    select 1 from public.skills
    where canonical_name = 'CI/CD'
      and 'GitHub Actions' = any (aliases)
  ) then
    raise exception 'skills seed: CI/CD must keep the GitHub Actions alias';
  end if;
end $$;
