import assert from "node:assert/strict";
import test from "node:test";

import { normalizeGeneratedTypes } from "./supabase-types.mjs";

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
