begin;
set transaction read only;
do $$
begin
  if (select count(*) from auth.users where id='11111111-1111-4111-8111-111111111111'
      and encrypted_password=extensions.crypt('synthetic-password-only', encrypted_password)) <> 1 then
    raise exception 'SYNTHETIC_AUTH_RECORD_FAILURE';
  end if;
  if (select count(*) from storage.objects where bucket_id='synthetic-recovery' and name='metadata-only.txt') <> 1 then
    raise exception 'SYNTHETIC_STORAGE_METADATA_FAILURE';
  end if;
  if (select extensions.pgp_sym_decrypt(ciphertext, 'synthetic-external-key') from private.recovery_cipher where id=1) <> 'synthetic-plaintext' then
    raise exception 'SYNTHETIC_COLUMN_DECRYPTION_FAILURE';
  end if;
  if current_setting('cron.launch_active_jobs') <> 'off' then
    raise exception 'SCHEDULER_NOT_DISABLED';
  end if;
end $$;
set local role recovery_fixture_reader;
set local meicare.synthetic_tenant='tenant-a';
do $$
begin
  if (select count(*) from public.recovery_tenant_probe) <> 1
     or exists (select 1 from public.recovery_tenant_probe where organization_id='tenant-b') then
    raise exception 'SYNTHETIC_TENANT_ISOLATION_FAILURE';
  end if;
  begin
    insert into public.recovery_tenant_probe values (3, 'tenant-a');
    raise exception 'SYNTHETIC_WRITE_PRIVILEGE_FAILURE';
  exception when insufficient_privilege then null;
  end;
end $$;
set local meicare.synthetic_tenant='unknown';
do $$ begin
  if exists (select 1 from public.recovery_tenant_probe) then
    raise exception 'SYNTHETIC_UNKNOWN_TENANT_FAILURE';
  end if;
end $$;
rollback;
