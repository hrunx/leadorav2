-- Sequential Pipeline Migration (idempotent)
-- Safe to run multiple times

-- 0) Extensions
create extension if not exists pgcrypto;
create extension if not exists vector;

-- 1) Idempotency cache TTL index
create index if not exists idempotency_ttl_idx on public.idempotency_cache (ttl_at);

-- 2) Embedding columns
alter table if exists public.business_personas add column if not exists embedding vector(1536);
alter table if exists public.decision_maker_personas add column if not exists embedding vector(1536);
alter table if exists public.businesses add column if not exists embedding vector(1536);
alter table if exists public.decision_makers add column if not exists embedding vector(1536);

-- 3) Vector indexes (cosine)
create index if not exists business_personas_embedding_idx on public.business_personas using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists dm_personas_embedding_idx on public.decision_maker_personas using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists businesses_embedding_idx on public.businesses using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists decision_makers_embedding_idx on public.decision_makers using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- 4) Dedupe/uniques
create unique index if not exists uniq_biz_per_search on public.businesses (search_id, lower(name), lower(country));
do $$ begin
  create unique index if not exists decision_makers_unique_per_search on public.decision_makers (search_id, linkedin);
exception when others then null; end $$;
do $$ begin
  create unique index if not exists uniq_dm_per_biz on public.decision_makers (business_id, lower(name), lower(title));
exception when others then null; end $$;

-- 5) Persona mapping RPC (cosine similarity)
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

-- 6) job_tasks uniqueness guard
do $$ begin
  alter table public.job_tasks add constraint job_tasks_job_id_name_unique unique (job_id, name);
exception when others then null; end $$;

-- 7) Market insights: payload sink + upsert target
alter table if exists public.market_insights add column if not exists payload jsonb;
do $$ begin
  create unique index if not exists market_insights_search_id_unique on public.market_insights (search_id);
exception when others then null; end $$;

-- 8) Response cache unique key
create unique index if not exists response_cache_key_unique on public.response_cache (cache_key);

-- Done

