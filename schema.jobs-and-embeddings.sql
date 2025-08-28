-- Enable required extensions
create extension if not exists pgcrypto;
create extension if not exists vector;

-- Jobs table for durable background work
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}',
  status text not null default 'queued', -- queued | running | done | failed
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 3,
  last_error text,
  claimed_by text,
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists jobs_status_run_at_idx on public.jobs (status, run_at);
create index if not exists jobs_type_idx on public.jobs (type);

-- Claim one job (setof for PostgREST compatibility)
create or replace function public.claim_job(worker_id text, wanted_types text[] default null)
returns setof public.jobs
language plpgsql as $$
declare
  v_job public.jobs%rowtype;
begin
  perform 1; -- no-op to satisfy plpgsql block
  with cte as (
    select id from public.jobs
    where status = 'queued'
      and run_at <= now()
      and (wanted_types is null or type = any (wanted_types))
    order by run_at asc
    limit 1
    for update skip locked
  )
  update public.jobs j
  set status = 'running', claimed_by = worker_id, claimed_at = now(), heartbeat_at = now()
  where j.id in (select id from cte)
  returning j.* into v_job;

  if v_job.id is not null then
    return next v_job;
  end if;
  return;
end;
$$;

create or replace function public.heartbeat_job(job_id uuid, worker_id text)
returns void language sql as $$
  update public.jobs set heartbeat_at = now() where id = job_id and claimed_by = worker_id;
$$;

create or replace function public.complete_job(job_id uuid, worker_id text)
returns void language sql as $$
  update public.jobs set status = 'done' where id = job_id and claimed_by = worker_id;
$$;

create or replace function public.fail_job(job_id uuid, worker_id text, error_text text, backoff_seconds int default 60)
returns void language plpgsql as $$
declare
  v_attempts int;
  v_max int;
begin
  select attempts, max_attempts into v_attempts, v_max from public.jobs where id = job_id for update;
  if not found then return; end if;
  v_attempts := coalesce(v_attempts,0) + 1;
  if v_attempts >= coalesce(v_max,3) then
    update public.jobs set status = 'failed', attempts = v_attempts, last_error = error_text where id = job_id and claimed_by = worker_id;
  else
    update public.jobs
    set status = 'queued', attempts = v_attempts, last_error = error_text, run_at = now() + make_interval(secs => greatest(5, backoff_seconds)), claimed_by = null, claimed_at = null, heartbeat_at = null
    where id = job_id and claimed_by = worker_id;
  end if;
end;
$$;

-- Vector columns for embedding-first mapping
alter table if exists public.business_personas add column if not exists embedding vector(1536);
alter table if exists public.decision_maker_personas add column if not exists embedding vector(1536);
alter table if exists public.businesses add column if not exists embedding vector(1536);

-- DM embeddings for vector mapping
alter table if exists public.decision_makers add column if not exists embedding vector(1536);
create index if not exists decision_makers_embedding_idx on public.decision_makers using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Indexes for vector similarity
create index if not exists business_personas_embedding_idx on public.business_personas using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists dm_personas_embedding_idx on public.decision_maker_personas using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists businesses_embedding_idx on public.businesses using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- RPCs to set embeddings from the app safely (PostgREST)
create or replace function public.set_business_persona_embedding(persona_id uuid, emb vector)
returns void language sql as $$
  update public.business_personas set embedding = emb where id = persona_id;
$$;

create or replace function public.set_dm_persona_embedding(persona_id uuid, emb vector)
returns void language sql as $$
  update public.decision_maker_personas set embedding = emb where id = persona_id;
$$;

create or replace function public.set_business_embedding(business_id uuid, emb vector)
returns void language sql as $$
  update public.businesses set embedding = emb where id = business_id;
$$;

-- Uniqueness and perf guards for discovery
do $$ begin
  alter table public.decision_makers add constraint decision_makers_unique_per_search unique (search_id, linkedin);
exception when others then null; end $$;

create index if not exists businesses_search_persona_idx on public.businesses (search_id, persona_id);
create index if not exists decision_makers_search_enrich_idx on public.decision_makers (search_id, enrichment_status);
create unique index if not exists response_cache_key_unique on public.response_cache (cache_key);

-- Expand response_cache.source to allow Google fallbacks
do $$ begin
  alter table public.response_cache drop constraint if exists response_cache_source_check;
exception when others then null; end $$;
alter table public.response_cache
  add constraint response_cache_source_check
  check (source in ('serper','deepseek','gemini','google_places','google_cse'));

-- Lightweight cache for LinkedIn role queries per company (if missing)
create table if not exists public.linkedin_query_cache (
  id uuid primary key default gen_random_uuid(),
  search_id uuid,
  company text not null,
  query text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists linkedin_query_cache_unique on public.linkedin_query_cache (company, query);

-- Match a business (with embedding) to the best business persona (same search)
create or replace function public.match_business_best_persona(business_id uuid)
returns table(persona_id uuid, score float)
language sql as $$
  select p.id as persona_id,
         1.0 - (p.embedding <#> b.embedding) as score
  from public.businesses b
  join public.business_personas p on p.search_id = b.search_id
  where b.id = business_id and b.embedding is not null and p.embedding is not null
  order by (p.embedding <#> b.embedding) asc
  limit 1;
$$;

-- Set DM embedding from app
create or replace function public.set_decision_maker_embedding(dm_id uuid, emb vector)
returns void language sql as $$
  update public.decision_makers set embedding = emb where id = dm_id;
$$;

-- Match a decision maker (with embedding) to top‑2 DM personas (same search)
create or replace function public.match_dm_top2_personas(dm_id uuid)
returns table(persona_id uuid, score float)
language sql as $$
  select p.id as persona_id,
         1.0 - (p.embedding <#> d.embedding) as score
  from public.decision_makers d
  join public.decision_maker_personas p on p.search_id = d.search_id
  where d.id = dm_id and d.embedding is not null and p.embedding is not null
  order by (p.embedding <#> d.embedding) asc
  limit 2;
$$;
