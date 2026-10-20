-- Esquema inicial: clínicas, membros, leads, acompanhamentos, modelos, histórico de mensagens e conexão do WhatsApp (futura).
-- Isolamento entre clínicas feito por RLS.

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  phone text check (phone ~ '^[0-9]{10,11}$'),
  attendant_name text,
  services text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clinic_members (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  display_name text,
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);
create index clinic_members_user_idx on public.clinic_members (user_id);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  phone text not null check (phone ~ '^[0-9]{10,11}$'),
  service text not null check (char_length(service) between 1 and 120),
  value numeric(12,2) constraint leads_value_nonneg check (value >= 0),
  stage text not null default 'novo' check (stage in ('novo','orcamento','aguardando','negociacao','convertido','perdido')),
  notes text,
  consent boolean not null default false,
  consent_at timestamptz,
  consent_source text,
  converted_at timestamptz,
  lost_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_phone_unique unique (clinic_id, phone),
  constraint leads_id_clinic_unique unique (id, clinic_id),
  constraint leads_consent_required check (not consent or (consent_at is not null and consent_source is not null)),
  constraint leads_stage_requires_value check (stage = 'novo' or value > 0)
);
create index leads_clinic_stage_idx on public.leads (clinic_id, stage);
create index leads_created_by_idx on public.leads (created_by);

create table public.followups (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  lead_id uuid not null,
  due_at timestamptz not null,
  note text,
  status text not null default 'pendente' check (status in ('pendente','concluido','cancelado')),
  history jsonb not null default '[]'::jsonb,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint followups_lead_same_clinic foreign key (lead_id, clinic_id) references public.leads(id, clinic_id) on delete cascade
);
create index followups_clinic_status_due_idx on public.followups (clinic_id, status, due_at);
create index followups_lead_clinic_idx on public.followups (lead_id, clinic_id);
create index followups_created_by_idx on public.followups (created_by);

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  body text not null check (char_length(body) between 10 and 1024),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index message_templates_clinic_idx on public.message_templates (clinic_id);

create table public.message_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  lead_id uuid not null,
  template_id uuid references public.message_templates(id) on delete set null,
  template_name text not null,
  body text not null,
  action text not null check (action in ('copiada','whatsapp','enviada_api')),
  delivery text not null default 'nao_confirmada' check (delivery in ('nao_confirmada','enviada','entregue','lida','falhou')),
  provider_message_id text,
  by_name text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint message_logs_lead_same_clinic foreign key (lead_id, clinic_id) references public.leads(id, clinic_id) on delete cascade
);
create index message_logs_clinic_lead_idx on public.message_logs (clinic_id, lead_id, created_at desc);
create index message_logs_lead_clinic_idx on public.message_logs (lead_id, clinic_id);
create index message_logs_template_idx on public.message_logs (template_id);
create index message_logs_created_by_idx on public.message_logs (created_by);

create table public.whatsapp_connections (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  status text not null default 'nao_conectado' check (status in ('nao_conectado','pendente','conectado','erro')),
  waba_id text,
  phone_number_id text,
  display_phone text,
  access_token_secret_id uuid,
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at = now(); return new; end $$;
create trigger t_clinics before update on public.clinics for each row execute function public.touch_updated_at();
create trigger t_leads before update on public.leads for each row execute function public.touch_updated_at();
create trigger t_followups before update on public.followups for each row execute function public.touch_updated_at();
create trigger t_templates before update on public.message_templates for each row execute function public.touch_updated_at();

create or replace function public.on_lead_stage_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.stage is distinct from old.stage then
    new.converted_at := case when new.stage = 'convertido' then now() end;
    new.lost_at := case when new.stage = 'perdido' then now() end;
    if new.stage in ('convertido','perdido') then
      update public.followups
         set status = 'cancelado', cancelled_at = now(),
             cancel_reason = 'Lead marcado como ' || new.stage
       where lead_id = new.id and clinic_id = new.clinic_id and status = 'pendente';
    end if;
  end if;
  return new;
end $$;
create trigger t_lead_stage before update of stage on public.leads
  for each row execute function public.on_lead_stage_change();

create or replace function public.is_clinic_member(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clinic_members m where m.clinic_id = cid and m.user_id = (select auth.uid()));
$$;
create or replace function public.is_clinic_admin(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clinic_members m where m.clinic_id = cid and m.user_id = (select auth.uid()) and m.role in ('owner','admin'));
$$;
revoke all on function public.is_clinic_member(uuid) from public, anon;
revoke all on function public.is_clinic_admin(uuid) from public, anon;
grant execute on function public.is_clinic_member(uuid) to authenticated;
grant execute on function public.is_clinic_admin(uuid) to authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  cid uuid; nm text; cn text; ph text;
begin
  cn := nullif(trim(new.raw_user_meta_data->>'clinic_name'), '');
  if cn is null then return new; end if;
  nm := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));
  ph := regexp_replace(coalesce(new.raw_user_meta_data->>'phone', ''), '\D', '', 'g');
  if length(ph) not in (10, 11) then ph := null; end if;
  insert into public.clinics (name, phone, attendant_name, services)
  values (left(cn, 120), ph, split_part(nm, ' ', 1),
          array['Toxina botulínica','Preenchimento labial','Harmonização facial','Bioestimulador de colágeno','Fios de PDO','Limpeza de pele','Peeling químico','Microagulhamento','Depilação a laser','Criolipólise'])
  returning id into cid;
  insert into public.clinic_members (clinic_id, user_id, role, display_name) values (cid, new.id, 'owner', nm);
  insert into public.message_templates (clinic_id, name, body) values
   (cid, 'Primeiro retorno', 'Olá, {{nome}}! Aqui é {{atendente}}, da {{clinica}}. Passando para saber se ficou alguma dúvida sobre o orçamento de {{servico}}. Posso te ajudar com algo?'),
   (cid, 'Condições de pagamento', 'Oi, {{nome}}, tudo bem? O orçamento de {{servico}} ficou em {{valor}} e temos opções de parcelamento que podem facilitar. Quer que eu te explique como funciona?'),
   (cid, 'Horários da semana', 'Olá, {{nome}}! Abrimos alguns horários para {{servico}} nesta semana aqui na {{clinica}}. Se quiser, reservo um para você.'),
   (cid, 'Último contato', 'Oi, {{nome}}! Não quero ser insistente: se agora não for o momento para {{servico}}, tudo bem. Fico à disposição quando quiser retomar. {{atendente}}, {{clinica}}.');
  insert into public.whatsapp_connections (clinic_id) values (cid);
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;
alter table public.leads enable row level security;
alter table public.followups enable row level security;
alter table public.message_templates enable row level security;
alter table public.message_logs enable row level security;
alter table public.whatsapp_connections enable row level security;

create policy clinics_select on public.clinics for select to authenticated using (public.is_clinic_member(id));
create policy clinics_update on public.clinics for update to authenticated using (public.is_clinic_admin(id)) with check (public.is_clinic_admin(id));
create policy members_select on public.clinic_members for select to authenticated using (public.is_clinic_member(clinic_id));

create policy leads_select on public.leads for select to authenticated using (public.is_clinic_member(clinic_id));
create policy leads_insert on public.leads for insert to authenticated with check (public.is_clinic_member(clinic_id));
create policy leads_update on public.leads for update to authenticated using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));
create policy leads_delete on public.leads for delete to authenticated using (public.is_clinic_admin(clinic_id));

create policy followups_select on public.followups for select to authenticated using (public.is_clinic_member(clinic_id));
create policy followups_insert on public.followups for insert to authenticated with check (public.is_clinic_member(clinic_id));
create policy followups_update on public.followups for update to authenticated using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));

create policy templates_select on public.message_templates for select to authenticated using (public.is_clinic_member(clinic_id));
create policy templates_insert on public.message_templates for insert to authenticated with check (public.is_clinic_member(clinic_id));
create policy templates_update on public.message_templates for update to authenticated using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));
create policy templates_delete on public.message_templates for delete to authenticated using (public.is_clinic_member(clinic_id));

create policy logs_select on public.message_logs for select to authenticated using (public.is_clinic_member(clinic_id));
create policy logs_insert on public.message_logs for insert to authenticated with check (
  public.is_clinic_member(clinic_id)
  and action in ('copiada','whatsapp')
  and delivery = 'nao_confirmada'
  and provider_message_id is null
  and exists (select 1 from public.leads l where l.id = lead_id and l.clinic_id = message_logs.clinic_id and l.consent)
);

create policy wa_select on public.whatsapp_connections for select to authenticated using (public.is_clinic_member(clinic_id));

revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.whatsapp_connections from authenticated;
revoke insert, update, delete on public.clinic_members from authenticated;
revoke insert, delete on public.clinics from authenticated;
