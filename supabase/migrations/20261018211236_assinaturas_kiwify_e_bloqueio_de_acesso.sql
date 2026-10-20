-- Assinaturas vindas da Kiwify e bloqueio do app para clínicas sem pagamento ativo.

create table public.subscriptions (
  email text primary key check (email = lower(email)),
  status text not null check (status in ('ativa','atrasada','cancelada','reembolsada','chargeback')),
  plan_name text,
  product_id text,
  product_name text,
  kiwify_order_id text,
  kiwify_subscription_id text,
  access_until timestamptz,
  last_event text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy subs_select_own on public.subscriptions for select to authenticated
  using (email = lower((select auth.jwt() ->> 'email')));
revoke insert, update, delete on public.subscriptions from anon, authenticated;

create table public.billing_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  event text,
  email text,
  order_id text,
  signature_ok boolean not null default false,
  payload jsonb
);
alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;

create or replace function private.email_has_access(e text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subscriptions s
    where s.email = lower(e)
      and (s.status in ('ativa','atrasada') or (s.status = 'cancelada' and s.access_until > now()))
  );
$$;
create or replace function private.clinic_has_access(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clinic_members m
    join auth.users u on u.id = m.user_id
    where m.clinic_id = cid and m.role = 'owner' and private.email_has_access(u.email)
  );
$$;
revoke all on function private.email_has_access(text) from public, anon;
revoke all on function private.clinic_has_access(uuid) from public, anon;
grant execute on function private.email_has_access(text) to authenticated;
grant execute on function private.clinic_has_access(uuid) to authenticated;

create or replace function public.my_access()
returns table (has_access boolean, status text, plan_name text, access_until timestamptz, email text)
language sql stable security invoker set search_path = '' as $$
  select private.clinic_has_access(m.clinic_id), s.status, s.plan_name, s.access_until, lower((select auth.jwt() ->> 'email'))
  from public.clinic_members m
  left join public.subscriptions s on s.email = lower((select auth.jwt() ->> 'email'))
  where m.user_id = (select auth.uid())
  limit 1;
$$;
revoke all on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;

-- Regras restritivas: somam-se às atuais (AND). Sem assinatura ativa, nada é lido nem gravado.
create policy paid_leads on public.leads as restrictive for all to authenticated
  using (private.clinic_has_access(clinic_id)) with check (private.clinic_has_access(clinic_id));
create policy paid_followups on public.followups as restrictive for all to authenticated
  using (private.clinic_has_access(clinic_id)) with check (private.clinic_has_access(clinic_id));
create policy paid_templates on public.message_templates as restrictive for all to authenticated
  using (private.clinic_has_access(clinic_id)) with check (private.clinic_has_access(clinic_id));
create policy paid_logs on public.message_logs as restrictive for all to authenticated
  using (private.clinic_has_access(clinic_id)) with check (private.clinic_has_access(clinic_id));
create policy paid_clinic_update on public.clinics as restrictive for update to authenticated
  using (private.clinic_has_access(id)) with check (private.clinic_has_access(id));
