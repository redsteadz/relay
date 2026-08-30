import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = resolve(root, "supabase/migrations");
const targetMigration = "202608290004_gmail_history.sql";
const requiredPriorMigrations = [
  "202608290002_custom_categories.sql",
  "202608290003_privacy_controls.sql",
];

function run(command, args, input) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "pipe" });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", () => reject(new Error(`${command} could not start`)));
    child.on("close", (code) => {
      resolveRun({
        code: code ?? 1,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
    child.stdin.end(input);
  });
}

async function requiredRun(command, args, input) {
  const result = await run(command, args, input);
  if (result.code !== 0) throw new Error(`${command} failed with exit code ${result.code}`);
  return result.stdout;
}

async function psql(container, database, sql) {
  return run(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "--set",
      "ON_ERROR_STOP=1",
      "--username",
      "postgres",
      "--dbname",
      database,
    ],
    sql,
  );
}

async function requiredPsql(container, database, sql) {
  const result = await psql(container, database, sql);
  if (result.code !== 0) throw new Error("Gmail migration upgrade harness SQL failed");
}

const connectionValues = (id, userId, mailbox, status) => `(
  '${id}', '${userId}', 'gmail', '${mailbox}', decode(repeat('11', 16), 'hex'),
  decode(repeat('12', 12), 'hex'), decode(repeat('13', 48), 'hex'),
  decode(repeat('14', 12), 'hex'), 1,
  array['https://www.googleapis.com/auth/gmail.readonly'], '${status}', 'production'
)`;

async function createPriorDatabase(container, database, priorMigrations) {
  await requiredPsql(container, "postgres", `create database "${database}";`);
  await requiredPsql(
    container,
    database,
    `
      create schema auth;
      create table auth.users (
        id uuid primary key,
        email text,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create function auth.uid() returns uuid language sql stable as $$
        select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
      $$;
      create schema extensions;
      ${priorMigrations}
    `,
  );
}

async function dropDatabase(container, database) {
  await requiredPsql(
    container,
    "postgres",
    `
      select pg_terminate_backend(pid) from pg_stat_activity
      where datname = '${database}' and pid <> pg_backend_pid();
      drop database if exists "${database}";
    `,
  );
}

async function main() {
  const config = await readFile(resolve(root, "supabase/config.toml"), "utf8");
  const projectId = /^project_id\s*=\s*"([a-z0-9_-]+)"$/mu.exec(config)?.[1];
  if (projectId === undefined) throw new Error("Supabase project ID is unavailable");
  const names = await requiredRun("docker", [
    "ps",
    "--filter",
    `label=com.supabase.cli.project=${projectId}`,
    "--filter",
    "name=supabase_db_",
    "--format",
    "{{.Names}}",
  ]);
  const containers = names.trim().split("\n").filter(Boolean);
  if (containers.length !== 1) throw new Error("Local Supabase database container is unavailable");
  const container = containers[0];

  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql") && name < targetMigration)
    .sort();
  if (
    requiredPriorMigrations.some((name) => !migrationNames.includes(name)) ||
    requiredPriorMigrations.some(
      (name, index) =>
        index > 0 &&
        migrationNames.indexOf(name) <= migrationNames.indexOf(requiredPriorMigrations[index - 1]),
    )
  ) {
    throw new Error("Gmail migration prerequisites are missing or out of order");
  }
  const priorMigrations = (
    await Promise.all(
      migrationNames.map((name) => readFile(resolve(migrationsDirectory, name), "utf8")),
    )
  ).join("\n");
  const gmailMigration = await readFile(resolve(migrationsDirectory, targetMigration), "utf8");
  const suffix = `${process.pid.toString()}_${Date.now().toString()}`;

  const successDatabase = `relay_gmail_upgrade_success_${suffix}`;
  try {
    await createPriorDatabase(container, successDatabase, priorMigrations);
    await requiredPsql(
      container,
      successDatabase,
      `
        insert into auth.users (id) values ('91000000-0000-0000-0000-000000000001');
        insert into public.connections (
          id, user_id, provider, external_account_id, credential_ciphertext, credential_nonce,
          wrapped_data_key, wrap_nonce, key_version, scopes, status, encryption_environment
        ) values
          ${connectionValues("91100000-0000-0000-0000-000000000001", "91000000-0000-0000-0000-000000000001", " Active@Example.Test ", "active")},
          ${connectionValues("91200000-0000-0000-0000-000000000002", "91000000-0000-0000-0000-000000000001", "legacy malformed mailbox", "revoked")};
        begin;
        ${gmailMigration}
        commit;
        do $$
        begin
          if (select external_account_id from public.connections
              where id = '91100000-0000-0000-0000-000000000001')
              is distinct from 'active@example.test' then
            raise exception 'active mailbox backfill failed';
          end if;
          if (select external_account_id from public.connections
              where id = '91200000-0000-0000-0000-000000000002')
              is distinct from 'legacy malformed mailbox' then
            raise exception 'inactive mailbox changed';
          end if;
           update public.connections set metadata = '{"checked":true}'::jsonb
           where id = '91200000-0000-0000-0000-000000000002';
           if exists (
             select 1 from public.connections
             where id = '91100000-0000-0000-0000-000000000001'
               and (
                 encode(credential_ciphertext, 'hex') <> repeat('11', 16)
                 or encode(credential_nonce, 'hex') <> repeat('12', 12)
                 or encode(wrapped_data_key, 'hex') <> repeat('13', 48)
                 or encode(wrap_nonce, 'hex') <> repeat('14', 12)
                 or key_version <> 1
                 or encryption_environment <> 'production'
               )
           ) or not exists (
             select 1 from public.connections
             where id = '91100000-0000-0000-0000-000000000001'
           ) then
             raise exception 'active credential bytes changed';
           end if;
           if not exists (
             select 1 from public.gmail_connection_state
             where connection_id = '91100000-0000-0000-0000-000000000001'
               and normalized_email = 'active@example.test'
           ) then
             raise exception 'active Gmail state backfill failed';
           end if;
         end;
         $$;

         set role authenticated;
         select set_config(
           'request.jwt.claims',
           '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}',
           false
         );
         do $$
         declare
           affected integer;
         begin
           delete from public.connections
           where id = '91100000-0000-0000-0000-000000000001';
           get diagnostics affected = row_count;
           if affected <> 0 then
             raise exception 'upgraded policy allowed active Gmail delete';
           end if;

           delete from public.connections
           where id = '91200000-0000-0000-0000-000000000002';
           get diagnostics affected = row_count;
           if affected <> 1 then
             raise exception 'upgraded policy blocked inactive Gmail delete';
           end if;
          end;
          $$;
          reset role;

          do $$
          begin
            if to_regprocedure('public.purge_own_raw_payloads()') is null
              or to_regprocedure('public.finalize_account_deletion(uuid)') is null then
              raise exception 'privacy migration was not applied before Gmail';
            end if;
            if not exists (
              select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'categories'
                and column_name = 'normalized_name'
            ) then
              raise exception 'custom category migration was not applied before Gmail';
            end if;
          end;
          $$;

          insert into public.source_items (
            id, user_id, source, external_id, occurred_at, captured_at, content_fingerprint,
            raw_expires_at, encryption_environment, raw_ciphertext, raw_nonce, wrapped_data_key,
            wrap_nonce, key_version
          ) values (
            '91300000-0000-0000-0000-000000000003',
            '91000000-0000-0000-0000-000000000001',
            'email', 'expired-source', now(), now(), repeat('a', 64), now() - interval '1 second',
            'production', decode(repeat('31', 16), 'hex'), decode(repeat('32', 12), 'hex'),
            decode(repeat('33', 48), 'hex'), decode(repeat('34', 12), 'hex'), 1
          );
          insert into public.dead_letter_items (
            id, user_id, envelope_id, failure_code, accepted_at, raw_expires_at,
            encryption_environment, ciphertext, nonce, wrapped_data_key, wrap_nonce, key_version
          ) values (
            '91400000-0000-0000-0000-000000000004',
            '91000000-0000-0000-0000-000000000001',
            '91500000-0000-0000-0000-000000000005',
            'retry_exhausted_unknown', now() - interval '8 days', now() - interval '1 day',
            'production', decode(repeat('41', 16), 'hex'), decode(repeat('42', 12), 'hex'),
            decode(repeat('43', 48), 'hex'), decode(repeat('44', 12), 'hex'), 1
          );
          insert into public.gmail_terminal_message_receipts (
            connection_id, user_id, message_digest, reason, completed_at, expires_at
          ) values (
            '91100000-0000-0000-0000-000000000001',
            '91000000-0000-0000-0000-000000000001', repeat('b', 64),
            'provider-message-missing', now() - interval '8 days', now() - interval '1 day'
          );
          insert into public.gmail_disconnect_tombstones (
            mailbox_digest, connection_id, user_id, completed_at, expires_at
          ) values (
            repeat('c', 64), '91100000-0000-0000-0000-000000000001',
            '91000000-0000-0000-0000-000000000001',
            now() - interval '2 days', now() - interval '1 day'
          );

          do $$
          declare
            purged bigint;
          begin
            purged := public.purge_expired_raw_payloads(now());
            if purged <> 4 then
              raise exception 'composed retention purge returned % instead of 4', purged;
            end if;
            if exists (
              select 1 from public.source_items
              where id = '91300000-0000-0000-0000-000000000003' and raw_ciphertext is not null
            ) then
              raise exception 'source cleanup was lost';
            end if;
            if not exists (
              select 1 from public.dead_letter_items
              where id = '91400000-0000-0000-0000-000000000004'
                and status = 'expired' and ciphertext is null
            ) then
              raise exception 'dead-letter cleanup was lost';
            end if;
            if exists (select 1 from public.gmail_terminal_message_receipts)
              or exists (select 1 from public.gmail_disconnect_tombstones) then
              raise exception 'Gmail retention cleanup was not added';
            end if;
          end;
          $$;

          insert into public.filter_rules (id, user_id, name, intent, plan) values (
            '91600000-0000-0000-0000-000000000006',
            '91000000-0000-0000-0000-000000000001',
            'Upgrade composition rule', 'test account deletion composition', '{"deterministic":[]}'
          );
          insert into public.action_rules (
            id, user_id, filter_rule_id, connection_id, provider, operation, input_template
          ) values (
            '91700000-0000-0000-0000-000000000007',
            '91000000-0000-0000-0000-000000000001',
            '91600000-0000-0000-0000-000000000006',
            '91100000-0000-0000-0000-000000000001',
            'google-tasks', 'create', '{}'
          );
          select public.request_account_deletion('91000000-0000-0000-0000-000000000001');
          select public.mark_account_connectors_revoked('91000000-0000-0000-0000-000000000001');

          do $$
          declare
            finalized public.account_deletions;
          begin
            finalized := public.finalize_account_deletion(
              '91000000-0000-0000-0000-000000000001'
            );
            if finalized.state <> 'completed'
              or exists (
                select 1 from public.connections
                where user_id = '91000000-0000-0000-0000-000000000001'
              )
              or exists (
                select 1 from public.gmail_connection_state
                where user_id = '91000000-0000-0000-0000-000000000001'
              )
              or not exists (
                select 1 from public.action_rules
                where id = '91700000-0000-0000-0000-000000000007'
                  and not enabled and connection_id is null
              ) then
              raise exception 'account deletion did not compose with Gmail ownership';
            end if;
            finalized := public.finalize_account_deletion(
              '91000000-0000-0000-0000-000000000001'
            );
            if finalized.state <> 'completed' then
              raise exception 'account deletion retry did not converge';
            end if;
          end;
          $$;

          insert into public.gmail_disconnect_receipts (
            connection_id, user_id, action_id, reason, watch_stopped, token_revoked,
            provider_already_revoked, detached_action_rule_count
          ) values (
            '91100000-0000-0000-0000-000000000001',
            '91000000-0000-0000-0000-000000000001',
            '91800000-0000-0000-0000-000000000008',
            'user-disconnect', true, true, false, 1
          );
          insert into public.gmail_disconnect_tombstones (
            mailbox_digest, connection_id, user_id, expires_at
          ) values (
            repeat('d', 64), '91100000-0000-0000-0000-000000000001',
            '91000000-0000-0000-0000-000000000001', now() + interval '1 day'
          );
          insert into public.gmail_terminal_message_receipts (
            connection_id, user_id, message_digest, reason
          ) values (
            '91100000-0000-0000-0000-000000000001',
            '91000000-0000-0000-0000-000000000001', repeat('e', 64),
            'provider-message-missing'
          );
          delete from auth.users where id = '91000000-0000-0000-0000-000000000001';

          do $$
          begin
            if exists (
              select 1 from public.gmail_disconnect_receipts
              where user_id = '91000000-0000-0000-0000-000000000001'
              union all select 1 from public.gmail_disconnect_tombstones
              where user_id = '91000000-0000-0000-0000-000000000001'
              union all select 1 from public.gmail_terminal_message_receipts
              where user_id = '91000000-0000-0000-0000-000000000001'
              union all select 1 from public.account_deletions
              where user_id = '91000000-0000-0000-0000-000000000001'
              union all select 1 from public.categories
              where user_id = '91000000-0000-0000-0000-000000000001'
            ) then
              raise exception 'auth deletion did not cascade composed tenant rows';
            end if;
          end;
          $$;
        `,
    );
  } finally {
    await dropDatabase(container, successDatabase);
  }

  for (const scenario of [
    {
      name: "collision",
      expected: "Active Gmail mailbox ownership is ambiguous",
      forbidden: ["Collision@Example.Test", " collision@example.test "],
      fixture: `
        insert into auth.users (id) values
          ('92000000-0000-0000-0000-000000000001'),
          ('92000000-0000-0000-0000-000000000002');
        insert into public.connections (
          id, user_id, provider, external_account_id, credential_ciphertext, credential_nonce,
          wrapped_data_key, wrap_nonce, key_version, scopes, status, encryption_environment
        ) values
          ${connectionValues("92100000-0000-0000-0000-000000000001", "92000000-0000-0000-0000-000000000001", "Collision@Example.Test", "active")},
          ${connectionValues("92200000-0000-0000-0000-000000000002", "92000000-0000-0000-0000-000000000002", " collision@example.test ", "active")};
      `,
    },
    {
      name: "invalid",
      expected: "Active Gmail mailbox ownership is invalid",
      forbidden: ["not-an-email"],
      fixture: `
        insert into auth.users (id) values ('93000000-0000-0000-0000-000000000001');
        insert into public.connections (
          id, user_id, provider, external_account_id, credential_ciphertext, credential_nonce,
          wrapped_data_key, wrap_nonce, key_version, scopes, status, encryption_environment
        ) values
          ${connectionValues("93100000-0000-0000-0000-000000000001", "93000000-0000-0000-0000-000000000001", "not-an-email", "active")};
      `,
    },
  ]) {
    const database = `relay_gmail_upgrade_${scenario.name}_${suffix}`;
    try {
      await createPriorDatabase(container, database, priorMigrations);
      await requiredPsql(container, database, scenario.fixture);
      const result = await psql(container, database, `begin;\n${gmailMigration}\ncommit;`);
      if (result.code === 0 || !result.stderr.includes(scenario.expected)) {
        throw new Error(`Gmail ${scenario.name} migration did not fail safely`);
      }
      if (scenario.forbidden.some((value) => result.stderr.includes(value))) {
        throw new Error(`Gmail ${scenario.name} migration reflected mailbox data`);
      }
      await requiredPsql(
        container,
        database,
        `
          do $$
          begin
            if to_regclass('public.gmail_connection_state') is not null then
              raise exception 'failed migration did not roll back';
            end if;
          end;
          $$;
        `,
      );
    } finally {
      await dropDatabase(container, database);
    }
  }

  process.stdout.write("Gmail migration upgrade harness passed\n");
}

main().catch((error) => {
  globalThis.console.error(
    error instanceof Error ? error.message : "Gmail migration harness failed",
  );
  process.exitCode = 1;
});
