import type { IngressQueueMessage as ContractIngressQueueMessage } from "@relay/contracts";

export type IngressQueueMessage = ContractIngressQueueMessage;

export interface Env {
  INGRESS_QUEUE: Queue<IngressQueueMessage>;
  PIPELINE_METRICS?: AnalyticsEngineDataset;
  RELAY_ALLOW_LOCAL_DURABILITY?: string;
  RELAY_CREDENTIAL_KEK_KEYRING: string;
  RELAY_E2E_DEAD_LETTER_QUEUE?: string;
  RELAY_E2E_MODE?: string;
  RELAY_E2E_RETENTION_NOW?: string;
  RELAY_ENVIRONMENT: string;
  RELAY_INGEST_SHARED_SECRET: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_URL?: string;
  TENANT_COORDINATOR: DurableObjectNamespace;
}
