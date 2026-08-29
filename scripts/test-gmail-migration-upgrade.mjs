import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = resolve(root, "supabase/migrations");
const targetMigration = "202608290002_gmail_history.sql";

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
