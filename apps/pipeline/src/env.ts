import type { IngressQueueMessage as ContractIngressQueueMessage } from "@relay/contracts";

export type IngressQueueMessage = ContractIngressQueueMessage;

export interface Env {
  DEBUG?: string;
  DEAD_LETTER_QUEUE: Queue<IngressQueueMessage>;
  INGRESS_QUEUE: Queue<IngressQueueMessage>;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_GMAIL_PUBSUB_TOPIC?: string;
  GOOGLE_PUBSUB_MESSAGE_RETENTION_SECONDS?: string;
  PIPELINE_METRICS?: AnalyticsEngineDataset;
  RELAY_ALLOW_LOCAL_DURABILITY?: string;
  RELAY_CREDENTIAL_KEK_KEYRING: string;
  RELAY_DEAD_LETTER_QUEUE: string;
  RELAY_E2E_DEAD_LETTER_QUEUE?: string;
  RELAY_E2E_MODE?: string;
  RELAY_E2E_RETENTION_NOW?: string;
  RELAY_ENVIRONMENT: string;
  RELAY_INGEST_SHARED_SECRET: string;
  RELAY_RECOVERY_SHARED_SECRET: string;
  // Semantic evaluation endpoint. Absent means OpenAI with the default model, so an existing
  // deployment is unaffected. See `readSemanticEndpointDefaults`.
  RELAY_SEMANTIC_BASE_URL?: string;
  RELAY_SEMANTIC_MODEL?: string;
  RELAY_SEMANTIC_RESPONSE_FORMAT?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_URL?: string;
  TENANT_COORDINATOR: DurableObjectNamespace;
}
