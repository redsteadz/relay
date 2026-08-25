import assert from "node:assert/strict";
import test from "node:test";

import { localTypeGenerationEnvironment, normalizeGeneratedTypes } from "./supabase-types.mjs";

test("replaces hosted database password for local type generation", () => {
  assert.deepEqual(
    localTypeGenerationEnvironment({ PATH: "/bin", SUPABASE_DB_PASSWORD: "hosted-secret" }),
    { PATH: "/bin", SUPABASE_DB_PASSWORD: "postgres" },
  );
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
