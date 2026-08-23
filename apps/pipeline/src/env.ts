import type { EncryptedValue } from "@relay/crypto";

export type IngressQueueMessage = {
  userId: string;
  envelopeId: string;
  encrypted: EncryptedValue;
};

export type ActionWorkflowParams = {
  userId: string;
  actionRunId: string;
};

export interface Env {
  ACTION_WORKFLOW: Workflow<ActionWorkflowParams>;
  INGRESS_QUEUE: Queue<IngressQueueMessage>;
  RELAY_ALLOW_LOCAL_DURABILITY?: string;
  RELAY_CREDENTIAL_KEK: string;
  RELAY_ENVIRONMENT: string;
  RELAY_INGEST_SHARED_SECRET: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_URL?: string;
  TENANT_COORDINATOR: DurableObjectNamespace;
}
