-- Abonnements Web Push : un enregistrement par appareil ayant activé les
-- notifications. Chaque utilisateur ne gère que ses propres abonnements ;
-- l'Edge Function notify-change les lit en service role pour pousser vers
-- les appareils de l'autre parent.

create table push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

create index push_subscriptions_user on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

create policy push_subscriptions_select on push_subscriptions for select
  using (user_id = (select auth.uid()));
create policy push_subscriptions_insert on push_subscriptions for insert
  with check (user_id = (select auth.uid()));
create policy push_subscriptions_update on push_subscriptions for update
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_subscriptions_delete on push_subscriptions for delete
  using (user_id = (select auth.uid()));
