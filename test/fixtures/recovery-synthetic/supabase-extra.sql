-- E4 synthetic-only managed data and role/RLS probe.
create role recovery_fixture_reader nologin;
create table public.recovery_tenant_probe (id integer primary key, organization_id text not null);
alter table public.recovery_tenant_probe enable row level security;
grant usage on schema public to recovery_fixture_reader;
grant select on public.recovery_tenant_probe to recovery_fixture_reader;
create policy fixture_tenant on public.recovery_tenant_probe
  to recovery_fixture_reader using (organization_id = current_setting('meicare.synthetic_tenant', true));
insert into public.recovery_tenant_probe values (1, 'tenant-a'), (2, 'tenant-b');
insert into auth.users (id, email, aud, role, encrypted_password, email_confirmed_at)
values ('11111111-1111-4111-8111-111111111111', 'restore-fixture@example.invalid',
        'authenticated', 'authenticated', extensions.crypt('synthetic-password-only', extensions.gen_salt('bf')), now());
insert into storage.buckets (id, name, public) values ('synthetic-recovery', 'synthetic-recovery', false);
insert into storage.objects (bucket_id, name) values ('synthetic-recovery', 'metadata-only.txt');
create table private.recovery_cipher (id integer primary key, ciphertext bytea);
insert into private.recovery_cipher values (1, extensions.pgp_sym_encrypt('synthetic-plaintext', 'synthetic-external-key'));
