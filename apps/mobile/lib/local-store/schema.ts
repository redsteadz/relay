/**
 * The device's own copy of the rows the inbox reads.
 *
 * Column names mirror what PostgREST returns rather than a friendlier local shape, because the
 * readers are the shipped feature modules: `features/inbox/api/inbox.ts` selects `raw_expires_at`
 * and `processed_at` and reads facts by `source_item_id`, and a local path has to answer the same
 * questions without a translation layer sitting between the two. Where the server scopes a row by
 * `user_id` under row-level security, this scopes it by `tenant_id` and every statement supplies one.
 *
 * What is deliberately absent is a `body` column, and `subject` and `sender` are deliberately
 * present. That split is not new: `source_items` already stores `sender`, `subject`,
 * `application_id` and `occurred_at` as ordinary columns and encrypts only the raw payload into
 * `raw_ciphertext` (`supabase/migrations/202608240001_initial_schema.sql`). The device keeps its
 * readable copy of what a capture said in `capture_content`, encrypted under a per-tenant
 * AndroidKeyStore key and read back through `getRetainedCaptureContent`. This store adds no second
 * home for that text, so nothing here weakens a protection the capture already has.
 */

/**
 * Bumped for every appended migration. `PRAGMA user_version` records how far a device has run, so a
 * partially migrated database resumes rather than being rebuilt.
 */
export const LOCAL_STORE_SCHEMA_VERSION = 2;

export const LOCAL_STORE_DATABASE_NAME = "relay-local.db";

/**
 * Columns this store must never hold.
 *
 * The privacy decision above is a property of the schema, so it is checked as one. A migration that
 * introduces a place to keep source text fails its test rather than being caught in review, or not.
 */
export const FORBIDDEN_LOCAL_COLUMNS: readonly string[] = [
  "body",
  "raw_ciphertext",
  "raw_nonce",
  "ciphertext",
  "wrapped_data_key",
  "access_token",
  "api_key",
];

/**
 * Every migration, in order, each a list of statements applied in one transaction.
 *
 * Index 0 produces schema version 1. Appending a migration is the only supported change; editing an
 * existing one would leave two devices claiming the same version with different tables.
 */
export const LOCAL_STORE_MIGRATIONS: readonly (readonly string[])[] = [
  [
    `CREATE TABLE source_items (
      tenant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      source TEXT NOT NULL,
      application_id TEXT,
      sender TEXT,
      subject TEXT,
      occurred_at TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      processed_at TEXT,
      raw_expires_at TEXT,
      attributes TEXT NOT NULL DEFAULT '{}',
      content_fingerprint TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    )`,
    // The inbox orders by arrival and retention walks by capture time, so both get an index rather
    // than a scan that grows with history.
    `CREATE INDEX source_items_recent ON source_items (tenant_id, created_at DESC)`,
    `CREATE INDEX source_items_captured ON source_items (tenant_id, captured_at)`,

    `CREATE TABLE source_facts (
      tenant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      source_item_id TEXT NOT NULL,
      normalizer_version INTEGER NOT NULL,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0 AND ordinal <= 63),
      kind TEXT NOT NULL,
      certainty TEXT NOT NULL CHECK (certainty IN ('certain', 'uncertain')),
      value TEXT,
      uncertainty_reason TEXT,
      provenance TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, source_item_id, normalizer_version, ordinal),
      -- An uncertain fact has no value: the normalizer records why it could not resolve one instead.
      -- Mirrors the paired constraint on public.source_facts, so a row that could never be stored
      -- server-side cannot be stored here either.
      CHECK (
        (certainty = 'certain' AND value IS NOT NULL AND uncertainty_reason IS NULL)
        OR (certainty = 'uncertain' AND value IS NULL AND uncertainty_reason IS NOT NULL)
      )
    )`,
    `CREATE INDEX source_facts_item ON source_facts (tenant_id, source_item_id)`,

    `CREATE TABLE relay_events (
      tenant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      source_item_id TEXT NOT NULL,
      normalizer_version INTEGER NOT NULL,
      extractor_version INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      starts_at TEXT,
      ends_at TEXT,
      due_at TEXT,
      temporal_status TEXT NOT NULL,
      date_ambiguity TEXT,
      time_zone TEXT,
      confidence REAL,
      requires_review INTEGER NOT NULL DEFAULT 0 CHECK (requires_review IN (0, 1)),
      provenance TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    )`,
    // Extraction is append-only by version, exactly as it is server-side, so one derivation of one
    // capture cannot be stored twice under the same versions.
    `CREATE UNIQUE INDEX relay_events_extraction ON relay_events
      (tenant_id, source_item_id, normalizer_version, extractor_version, ordinal)`,
    `CREATE INDEX relay_events_recent ON relay_events (tenant_id, created_at DESC)`,

    `CREATE TABLE classifications (
      tenant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      source_item_id TEXT NOT NULL,
      category_id TEXT,
      method TEXT NOT NULL CHECK (method IN ('deterministic', 'semantic', 'manual')),
      confidence REAL,
      rationale TEXT,
      model TEXT,
      origin TEXT NOT NULL CHECK (origin IN ('server', 'device')),
      filter_rule_id TEXT,
      superseded_at TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id),
      -- A device holds no model credential, so a device row claiming a semantic method would be a
      -- claim it could not have made. Mirrors classifications_device_is_deterministic.
      CHECK (origin <> 'device' OR method = 'deterministic')
    )`,
    // Mirrors classifications_current_per_item_idx: one current classification per capture, so
    // re-filing has to supersede rather than accumulate a second current row.
    `CREATE UNIQUE INDEX classifications_current_per_item ON classifications
      (tenant_id, source_item_id) WHERE superseded_at IS NULL`,

    `CREATE TABLE categories (
      tenant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
      quiet_by_default INTEGER NOT NULL DEFAULT 0 CHECK (quiet_by_default IN (0, 1)),
      sort_order INTEGER,
      archived_at TEXT,
      PRIMARY KEY (tenant_id, id)
    )`,
    `CREATE UNIQUE INDEX categories_slug ON categories (tenant_id, slug)`,

    `CREATE TABLE filter_rules (
      tenant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      series_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      intent TEXT NOT NULL,
      plan TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      category_id TEXT,
      compiler_version INTEGER,
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    )`,
    // Revisions are immutable server-side and identified by series and version; the local mirror
    // keeps that identity so the newest revision of a series is a query rather than a guess.
    `CREATE UNIQUE INDEX filter_rules_revision ON filter_rules (tenant_id, series_id, version)`,

    `CREATE TABLE hidden_inbox_events (
      tenant_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      hidden_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, event_id)
    )`,
  ],
  [
    /*
     * What this device sent to a model, and where.
     *
     * The device now evaluates semantic clauses itself (ADR-0019), which creates the disclosure
     * obligation the pipeline already carries. Column names mirror `public.ai_disclosures` so the
     * privacy screen reads a device row and a server row through one shape.
     *
     * Metadata only, and that is the whole point: field *names*, redaction counts, the endpoint
     * host, the model, the decision. Never the prompt, never a disclosed value. `endpoint_host`
     * matters more here than server-side, because a device endpoint is frequently a machine on the
     * reader's own network and history has to say so rather than implying OpenAI.
     *
     * `disclosed` is false when a clause was refused before anything left the device, so an attempt
     * that sent nothing is distinguishable from one that sent something and got nothing back.
     */
    `CREATE TABLE ai_disclosures (
      tenant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      source_item_id TEXT NOT NULL,
      filter_rule_id TEXT,
      provider TEXT NOT NULL DEFAULT 'openai',
      model TEXT NOT NULL,
      disclosed_fields TEXT NOT NULL,
      redactions TEXT NOT NULL DEFAULT '[]',
      purpose TEXT NOT NULL,
      decision TEXT NOT NULL DEFAULT 'undecided'
        CHECK(decision IN ('match','no-match','undecided')),
      disclosed INTEGER NOT NULL DEFAULT 1 CHECK(disclosed IN (0,1)),
      confidence REAL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
      failure_reason TEXT,
      endpoint_host TEXT,
      origin TEXT NOT NULL DEFAULT 'device' CHECK(origin = 'device'),
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    )`,
    /* The privacy screen reads newest-first for one tenant, which is the only query there is. */
    `CREATE INDEX ai_disclosures_recent ON ai_disclosures (tenant_id, created_at DESC)`,
  ],
];

/**
 * Tables holding rows derived from one capture, so retention can drop a capture and everything that
 * describes it together. Ordered child-first for deletion.
 */
export const CAPTURE_SCOPED_TABLES: readonly string[] = [
  "source_facts",
  "relay_events",
  "classifications",
  "source_items",
];

/** Every table, for clearing one tenant completely. */
export const LOCAL_STORE_TABLES: readonly string[] = [
  "source_facts",
  "relay_events",
  "classifications",
  "source_items",
  "categories",
  "filter_rules",
  "hidden_inbox_events",
  "ai_disclosures",
];
