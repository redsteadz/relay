-- Deterministic synthetic user used only by the local ingestion harness and mobile demo fixture.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'relay-local-harness@example.test', '', now(), now(), now()
);
