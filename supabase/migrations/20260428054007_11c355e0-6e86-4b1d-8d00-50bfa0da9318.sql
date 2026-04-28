create extension if not exists pgcrypto;

create table if not exists public.pending_registrations (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  code_hash text not null,
  attempts smallint not null default 0,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now()
);

alter table public.pending_registrations enable row level security;

-- No policies: only service-role (which bypasses RLS) can access.

create index if not exists pending_registrations_email_idx on public.pending_registrations (lower(email));
create index if not exists pending_registrations_expires_idx on public.pending_registrations (expires_at);

-- Helper to wipe expired pending registrations (called from edge functions opportunistically)
create or replace function public.cleanup_expired_pending_registrations()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.pending_registrations where expires_at < now();
$$;