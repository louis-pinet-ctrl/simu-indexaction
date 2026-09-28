-- Appliquée le 28/09/2026 sur le projet tcnzmfcmihwzoaaffgfz (nom : lectures_bail_journal_et_source_indexation).
-- Journal anti-abus de la lecture de bail : une ligne par appel, IP hachée, purgée après deux jours.
create table if not exists public.lectures_bail_journal (
  id bigserial primary key,
  ip_hash text not null,
  at timestamptz not null default now()
);
create index if not exists lectures_bail_journal_ip_at_idx on public.lectures_bail_journal (ip_hash, at);
alter table public.lectures_bail_journal enable row level security;
revoke all on public.lectures_bail_journal from anon, authenticated;
comment on table public.lectures_bail_journal is 'Limitation de fréquence de la fonction lecture-bail (5 lectures par IP et par heure). IP hachée, aucun contenu.';

do $$ begin
  perform cron.schedule('purge_lectures_bail_journal', '17 3 * * *',
    $cron$ delete from public.lectures_bail_journal where at < now() - interval '2 days' $cron$);
exception when others then null; end $$;

-- Les leads du simulateur d'indexation portent leur propre source.
alter table public.leads_site drop constraint if exists leads_site_source_check;
alter table public.leads_site add constraint leads_site_source_check
  check (source = any (array['formulaire_contact'::text, 'simulateur_valorisation'::text, 'newsletter'::text, 'simulateur_indexation'::text]));
