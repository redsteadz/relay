begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

-- Fixtures run as the migration role: `auth.users` inserts fire `handle_new_user`, which seeds the
-- ten system categories per tenant, and `classifications` is select-only under RLS.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  (
    '60000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'cat-one@example.test', '', now(), now(), now()
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'cat-two@example.test', '', now(), now(), now()
  );

insert into public.source_items (
  id, user_id, source, external_id, occurred_at, captured_at, content_fingerprint
) values (
  '61100000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  'email', 'synthetic-category-one', now(), now(), repeat('a', 64)
);

insert into public.categories (id, user_id, slug, name) values (
  '61200000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  'retired-project', 'Retired Project'
);

insert into public.classifications (
  user_id, source_item_id, category_id, method, confidence
) values (
  '60000000-0000-4000-8000-000000000001',
  '61100000-0000-4000-8000-000000000001',
  '61200000-0000-4000-8000-000000000001',
  'deterministic', 0.900
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

-- Criterion: create.
select lives_ok(
  $$insert into public.categories (user_id, slug, name)
    values ('60000000-0000-4000-8000-000000000001', 'work', '  Wörk   Notes ')$$,
  'tenant creates a custom category'
);

-- Criterion: documented normalization (NFKC, trim, collapse whitespace, lowercase).
select is(
  (select normalized_name from public.categories where slug = 'work'),
  'wörk notes',
  'custom category name normalizes under the documented rule'
);

-- Criterion: names are tenant-unique under that normalization.
select throws_ok(
  $$insert into public.categories (user_id, slug, name)
    values ('60000000-0000-4000-8000-000000000001', 'work-duplicate', 'WÖRK NOTES')$$,
  '23505',
  null,
  'tenant cannot hold two categories whose normalized names collide'
);

-- Criterion: rename, reorder, quiet.
select lives_ok(
  $$update public.categories
    set name = 'Work Notes Renamed', sort_order = 3, quiet_by_default = true
    where slug = 'work'$$,
  'tenant renames, reorders, and quiets a custom category'
);

select results_eq(
  $$select name, sort_order, quiet_by_default from public.categories where slug = 'work'$$,
  $$values ('Work Notes Renamed', 3, true)$$,
  'rename, reorder, and quiet all persist'
);

-- Criterion: archive.
select lives_ok(
  $$update public.categories set archived_at = now() where slug = 'work'$$,
  'tenant archives a custom category'
);

select ok(
  (select archived_at is not null from public.categories where slug = 'work'),
  'archived custom category retains its row'
);

-- Criterion: system slugs remain stable.
select throws_ok(
  $$update public.categories set slug = 'reassigned' where slug = 'transaction'$$,
  '42501',
  'System category slug is immutable',
  'system category slug cannot be changed'
);

select throws_ok(
  $$update public.categories set is_system = false where slug = 'transaction'$$,
  '42501',
  'Category system flag is immutable',
  'system flag cannot be cleared'
);

select throws_ok(
  $$delete from public.categories where slug = 'transaction'$$,
  '42501',
  'System category cannot be deleted',
  'system category cannot be deleted'
);

select throws_ok(
  $$update public.categories set archived_at = now() where slug = 'transaction'$$,
  '23514',
  null,
  'system category cannot be archived'
);

select throws_ok(
  $$insert into public.categories (user_id, slug, name, is_system)
    values ('60000000-0000-4000-8000-000000000001', 'fake-system', 'Fake System', true)$$,
  '42501',
  'System categories cannot be created by users',
  'tenant cannot mint a system category'
);

-- Criterion: archived categories preserve historical classifications.
select throws_ok(
  $$delete from public.categories where slug = 'retired-project'$$,
  '23503',
  'Category with existing classifications must be archived, not deleted',
  'category with classifications cannot be hard-deleted'
);

select lives_ok(
  $$update public.categories set archived_at = now() where slug = 'retired-project'$$,
  'category with classifications can be archived instead'
);

select results_eq(
  $$select c.category_id
    from public.classifications c
    where c.source_item_id = '61100000-0000-4000-8000-000000000001'$$,
  $$values ('61200000-0000-4000-8000-000000000001'::uuid)$$,
  'archiving preserves the historical classification reference'
);

-- Criterion: RLS across two users.
select results_eq(
  $$select count(*)::bigint from public.categories
    where user_id = '60000000-0000-4000-8000-000000000002'$$,
  'values (0::bigint)',
  'tenant cannot see another tenant categories'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

select results_eq(
  $$with changed as (
      update public.categories
      set name = 'Cross tenant rename'
      where user_id = '60000000-0000-4000-8000-000000000001' and slug = 'work'
      returning 1
    )
    select count(*)::bigint from changed$$,
  'values (0::bigint)',
  'second tenant cannot rename first tenant category'
);

select results_eq(
  $$select count(*)::bigint from public.categories where is_system$$,
  'values (10::bigint)',
  'second tenant still sees exactly its own ten system categories'
);

select * from finish();
rollback;
