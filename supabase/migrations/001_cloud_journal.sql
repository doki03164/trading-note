create table if not exists public.journal_items (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('trade','playbook','note','profit_snapshot')),
  payload jsonb not null default '{}'::jsonb,
  asset_path text,
  client_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists journal_items_user_kind_idx on public.journal_items(user_id, kind, client_updated_at desc);
alter table public.journal_items enable row level security;
grant select, insert, update, delete on public.journal_items to authenticated;
drop policy if exists "journal owners select" on public.journal_items;
create policy "journal owners select" on public.journal_items for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "journal owners insert" on public.journal_items;
create policy "journal owners insert" on public.journal_items for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "journal owners update" on public.journal_items;
create policy "journal owners update" on public.journal_items for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "journal owners delete" on public.journal_items;
create policy "journal owners delete" on public.journal_items for delete to authenticated using ((select auth.uid()) = user_id);
insert into storage.buckets (id, name, public) values ('trade-screenshots', 'trade-screenshots', false) on conflict (id) do nothing;
drop policy if exists "screenshot owners select" on storage.objects;
create policy "screenshot owners select" on storage.objects for select to authenticated using (bucket_id = 'trade-screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "screenshot owners insert" on storage.objects;
create policy "screenshot owners insert" on storage.objects for insert to authenticated with check (bucket_id = 'trade-screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "screenshot owners update" on storage.objects;
create policy "screenshot owners update" on storage.objects for update to authenticated using (bucket_id = 'trade-screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "screenshot owners delete" on storage.objects;
create policy "screenshot owners delete" on storage.objects for delete to authenticated using (bucket_id = 'trade-screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
