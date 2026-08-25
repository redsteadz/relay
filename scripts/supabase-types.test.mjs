import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { localTypeGenerationEnvironment, normalizeGeneratedTypes } from "./supabase-types.mjs";

test("uses local status password for local type generation", () => {
  const password = randomUUID();
  const databaseUrl = new URL("postgresql://127.0.0.1:55322/postgres");
  databaseUrl.username = "postgres";
  databaseUrl.password = password;

  const environment = localTypeGenerationEnvironment(
    { PATH: "/bin" },
    `DB_URL="${databaseUrl.toString()}"\n`,
  );

  assert.equal(environment.PATH, "/bin");
  assert.equal(environment.SUPABASE_DB_PASSWORD, password);
});

test("removes hosted PostgREST metadata without changing schema types", () => {
  const generated = `export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {};
  };
};
`;

  assert.equal(
    normalizeGeneratedTypes(generated),
    `export type Database = {
  public: {
    Tables: {};
  };
};
`,
  );
});

test("removes local PostgREST metadata without generated comments", () => {
  const generated = `export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13.0.5";
  };
  public: {
    Tables: {};
  };
};
`;

  assert.equal(
    normalizeGeneratedTypes(generated),
    `export type Database = {
  public: {
    Tables: {};
  };
};
`,
  );
});
