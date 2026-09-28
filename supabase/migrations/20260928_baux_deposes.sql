-- Appliquée le 28/09/2026 sur le projet tcnzmfcmihwzoaaffgfz (migration baux_deposes_simulateur_indexation).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('baux-deposes', 'baux-deposes', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create table if not exists public.baux_deposes (
  id uuid primary key default gen_random_uuid(),
  dossier uuid not null,
  recu_le timestamptz not null default now(),
  fichier_chemin text not null,
  fichier_nom text,
  fichier_type text,
  fichier_octets integer,
  consentement_texte text not null,
  extraction jsonb,
  lead_id uuid references public.leads_site(id) on delete set null,
  email text,
  supprimer_apres timestamptz not null default (now() + interval '12 months'),
  conserver_client boolean not null default false
);
create index if not exists baux_deposes_dossier_idx on public.baux_deposes (dossier);
create index if not exists baux_deposes_purge_idx on public.baux_deposes (supprimer_apres) where not conserver_client;
alter table public.baux_deposes enable row level security;

create or replace function public.fn_rattacher_bail_au_lead()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.payload ? 'bail_dossier' and (new.payload->>'bail_dossier') ~ '^[0-9a-f-]{36}$' then
    update public.baux_deposes set lead_id = new.id, email = new.email
     where dossier = (new.payload->>'bail_dossier')::uuid and lead_id is null;
  end if;
  return new;
end $$;
revoke all on function public.fn_rattacher_bail_au_lead() from public, anon, authenticated;
drop trigger if exists trg_rattacher_bail_au_lead on public.leads_site;
create trigger trg_rattacher_bail_au_lead after insert or update of payload on public.leads_site
for each row execute function public.fn_rattacher_bail_au_lead();

create or replace view public.v_baux_deposes with (security_invoker = true) as
select b.recu_le, b.dossier, b.fichier_nom, b.fichier_chemin, b.email,
       l.prenom, l.nom, l.telephone, l.profil_utilisateur,
       b.extraction->'loyer_annuel_ht'->>'valeur' as loyer_lu,
       b.extraction->'indice'->>'valeur' as indice_lu,
       b.supprimer_apres, b.conserver_client
  from public.baux_deposes b left join public.leads_site l on l.id = b.lead_id
 order by b.recu_le desc;
revoke all on public.v_baux_deposes from anon, authenticated;
revoke all on public.baux_deposes from anon, authenticated;
