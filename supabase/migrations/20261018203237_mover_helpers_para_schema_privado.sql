-- Funções auxiliares de permissão saem do schema público para não ficarem expostas via API.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
alter function public.is_clinic_member(uuid) set schema private;
alter function public.is_clinic_admin(uuid) set schema private;
