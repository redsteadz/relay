export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      account_deletions: {
        Row: {
          attempt_count: number;
          completed_at: string | null;
          connectors_revoked_at: string | null;
          requested_at: string;
          state: Database["public"]["Enums"]["account_deletion_state"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          attempt_count?: number;
          completed_at?: string | null;
          connectors_revoked_at?: string | null;
          requested_at?: string;
          state?: Database["public"]["Enums"]["account_deletion_state"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          attempt_count?: number;
          completed_at?: string | null;
          connectors_revoked_at?: string | null;
          requested_at?: string;
          state?: Database["public"]["Enums"]["account_deletion_state"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      action_rules: {
        Row: {
          approval_mode: string;
          connection_id: string | null;
          created_at: string;
          enabled: boolean;
          filter_rule_id: string;
          id: string;
          input_template: Json;
          operation: string;
          provider: Database["public"]["Enums"]["action_provider"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          approval_mode?: string;
          connection_id?: string | null;
          created_at?: string;
          enabled?: boolean;
          filter_rule_id: string;
          id?: string;
          input_template: Json;
          operation: string;
          provider: Database["public"]["Enums"]["action_provider"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          approval_mode?: string;
          connection_id?: string | null;
          created_at?: string;
          enabled?: boolean;
          filter_rule_id?: string;
          id?: string;
          input_template?: Json;
          operation?: string;
          provider?: Database["public"]["Enums"]["action_provider"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "action_rules_user_id_connection_id_fkey";
            columns: ["user_id", "connection_id"];
            isOneToOne: false;
            referencedRelation: "connections";
            referencedColumns: ["user_id", "id"];
          },
          {
            foreignKeyName: "action_rules_user_id_filter_rule_id_fkey";
            columns: ["user_id", "filter_rule_id"];
            isOneToOne: false;
            referencedRelation: "filter_rules";
            referencedColumns: ["user_id", "id"];
          },
        ];
      };
      action_runs: {
        Row: {
          action_rule_id: string;
          approved_at: string | null;
          attempt_count: number;
          completed_at: string | null;
          created_at: string;
          error_code: string | null;
          error_message: string | null;
          event_id: string;
          id: string;
          input: Json;
          provider: Database["public"]["Enums"]["action_provider"];
          provider_reference: string | null;
          status: Database["public"]["Enums"]["action_status"];
          updated_at: string;
          user_id: string;
          workflow_instance_id: string | null;
        };
        Insert: {
          action_rule_id: string;
          approved_at?: string | null;
          attempt_count?: number;
          completed_at?: string | null;
          created_at?: string;
          error_code?: string | null;
          error_message?: string | null;
          event_id: string;
          id?: string;
          input: Json;
          provider: Database["public"]["Enums"]["action_provider"];
          provider_reference?: string | null;
          status?: Database["public"]["Enums"]["action_status"];
          updated_at?: string;
          user_id: string;
          workflow_instance_id?: string | null;
        };
        Update: {
          action_rule_id?: string;
          approved_at?: string | null;
          attempt_count?: number;
          completed_at?: string | null;
          created_at?: string;
          error_code?: string | null;
          error_message?: string | null;
          event_id?: string;
          id?: string;
          input?: Json;
          provider?: Database["public"]["Enums"]["action_provider"];
          provider_reference?: string | null;
          status?: Database["public"]["Enums"]["action_status"];
          updated_at?: string;
          user_id?: string;
          workflow_instance_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "action_runs_user_id_action_rule_id_fkey";
            columns: ["user_id", "action_rule_id"];
            isOneToOne: false;
            referencedRelation: "action_rules";
            referencedColumns: ["user_id", "id"];
          },
          {
            foreignKeyName: "action_runs_user_id_event_id_fkey";
            columns: ["user_id", "event_id"];
            isOneToOne: false;
            referencedRelation: "relay_events";
            referencedColumns: ["user_id", "id"];
          },
        ];
      };
      ai_disclosures: {
        Row: {
          created_at: string;
          disclosed_fields: string[];
          filter_rule_id: string | null;
          id: string;
          model: string;
          provider: string;
          purpose: string;
          redactions: Json;
          source_item_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          disclosed_fields: string[];
          filter_rule_id?: string | null;
          id?: string;
          model: string;
          provider?: string;
          purpose: string;
          redactions?: Json;
          source_item_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          disclosed_fields?: string[];
          filter_rule_id?: string | null;
          id?: string;
          model?: string;
          provider?: string;
          purpose?: string;
          redactions?: Json;
          source_item_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_disclosures_user_id_filter_rule_id_fkey";
            columns: ["user_id", "filter_rule_id"];
            isOneToOne: false;
            referencedRelation: "filter_rules";
            referencedColumns: ["user_id", "id"];
          },
          {
            foreignKeyName: "ai_disclosures_user_id_source_item_id_fkey";
            columns: ["user_id", "source_item_id"];
            isOneToOne: false;
            referencedRelation: "source_items";
            referencedColumns: ["user_id", "id"];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_type: string;
          created_at: string;
          id: number;
          metadata: Json;
          target_id: string | null;
          target_type: string;
          user_id: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_type: string;
          created_at?: string;
          id?: never;
          metadata?: Json;
          target_id?: string | null;
          target_type: string;
          user_id: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_type?: string;
          created_at?: string;
          id?: never;
          metadata?: Json;
          target_id?: string | null;
          target_type?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          archived_at: string | null;
          created_at: string;
          description: string | null;
          id: string;
          is_system: boolean;
          name: string;
          normalized_name: string | null;
          quiet_by_default: boolean;
          slug: string;
          sort_order: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_system?: boolean;
          name: string;
          normalized_name?: string | null;
          quiet_by_default?: boolean;
          slug: string;
          sort_order?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_system?: boolean;
          name?: string;
          normalized_name?: string | null;
          quiet_by_default?: boolean;
          slug?: string;
          sort_order?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      classifications: {
        Row: {
          category_id: string | null;
          confidence: number;
          created_at: string;
          id: string;
          method: string;
          model: string | null;
          rationale: string | null;
          source_item_id: string;
          user_id: string;
        };
        Insert: {
          category_id?: string | null;
          confidence: number;
          created_at?: string;
          id?: string;
          method: string;
          model?: string | null;
          rationale?: string | null;
          source_item_id: string;
          user_id: string;
        };
        Update: {
          category_id?: string | null;
          confidence?: number;
          created_at?: string;
          id?: string;
          method?: string;
          model?: string | null;
          rationale?: string | null;
          source_item_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "classifications_user_id_category_id_fkey";
            columns: ["user_id", "category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["user_id", "id"];
          },
          {
            foreignKeyName: "classifications_user_id_source_item_id_fkey";
            columns: ["user_id", "source_item_id"];
            isOneToOne: false;
            referencedRelation: "source_items";
            referencedColumns: ["user_id", "id"];
          },
        ];
      };
      connections: {
        Row: {
          created_at: string;
          credential_ciphertext: string;
          credential_nonce: string;
          encryption_environment: string;
          external_account_id: string | null;
          id: string;
          key_version: number;
          metadata: Json;
          provider: string;
          scopes: string[];
          status: string;
          updated_at: string;
          user_id: string;
          wrap_nonce: string;
          wrapped_data_key: string;
        };
        Insert: {
          created_at?: string;
          credential_ciphertext: string;
          credential_nonce: string;
          encryption_environment: string;
          external_account_id?: string | null;
          id?: string;
          key_version?: number;
          metadata?: Json;
          provider: string;
          scopes?: string[];
          status?: string;
          updated_at?: string;
          user_id: string;
          wrap_nonce: string;
          wrapped_data_key: string;
        };
        Update: {
          created_at?: string;
          credential_ciphertext?: string;
          credential_nonce?: string;
          encryption_environment?: string;
          external_account_id?: string | null;
          id?: string;
          key_version?: number;
          metadata?: Json;
          provider?: string;
          scopes?: string[];
          status?: string;
          updated_at?: string;
          user_id?: string;
          wrap_nonce?: string;
          wrapped_data_key?: string;
        };
        Relationships: [];
      };
      dead_letter_items: {
        Row: {
          accepted_at: string;
          ciphertext: string | null;
          completed_at: string | null;
          encryption_aad_envelope_id: string | null;
          encryption_aad_user_id: string | null;
          encryption_environment: string | null;
          envelope_id: string;
          failure_code: string;
          first_failed_at: string;
          id: string;
          key_version: number | null;
          last_failed_at: string;
          last_replayed_at: string | null;
          nonce: string | null;
          raw_expires_at: string;
          replay_count: number;
          replay_request_id: string | null;
          status: string;
          user_id: string;
          wrap_nonce: string | null;
          wrapped_data_key: string | null;
        };
        Insert: {
          accepted_at: string;
          ciphertext?: string | null;
          completed_at?: string | null;
          encryption_aad_envelope_id?: string | null;
          encryption_aad_user_id?: string | null;
          encryption_environment?: string | null;
          envelope_id: string;
          failure_code: string;
          first_failed_at?: string;
          id: string;
          key_version?: number | null;
          last_failed_at?: string;
          last_replayed_at?: string | null;
          nonce?: string | null;
          raw_expires_at: string;
          replay_count?: number;
          replay_request_id?: string | null;
          status?: string;
          user_id: string;
          wrap_nonce?: string | null;
          wrapped_data_key?: string | null;
        };
        Update: {
          accepted_at?: string;
          ciphertext?: string | null;
          completed_at?: string | null;
          encryption_aad_envelope_id?: string | null;
          encryption_aad_user_id?: string | null;
          encryption_environment?: string | null;
          envelope_id?: string;
          failure_code?: string;
          first_failed_at?: string;
          id?: string;
          key_version?: number | null;
          last_failed_at?: string;
          last_replayed_at?: string | null;
          nonce?: string | null;
          raw_expires_at?: string;
          replay_count?: number;
          replay_request_id?: string | null;
          status?: string;
          user_id?: string;
          wrap_nonce?: string | null;
          wrapped_data_key?: string | null;
        };
        Relationships: [];
      };
      devices: {
        Row: {
          created_at: string;
          id: string;
          last_seen_at: string | null;
          name: string;
          platform: string;
          public_key: string | null;
          revoked_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          last_seen_at?: string | null;
          name: string;
          platform: string;
          public_key?: string | null;
          revoked_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          last_seen_at?: string | null;
          name?: string;
          platform?: string;
          public_key?: string | null;
          revoked_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      filter_rules: {
        Row: {
          approval_mode: string;
          created_at: string;
          dismiss_source_notification: boolean;
          dismissal_dry_run_completed_at: string | null;
          enabled: boolean;
          id: string;
          intent: string;
          name: string;
          plan: Json;
          updated_at: string;
          user_id: string;
          version: number;
        };
        Insert: {
          approval_mode?: string;
          created_at?: string;
          dismiss_source_notification?: boolean;
          dismissal_dry_run_completed_at?: string | null;
          enabled?: boolean;
          id?: string;
          intent: string;
          name: string;
          plan: Json;
          updated_at?: string;
          user_id: string;
          version?: number;
        };
        Update: {
          approval_mode?: string;
          created_at?: string;
          dismiss_source_notification?: boolean;
          dismissal_dry_run_completed_at?: string | null;
          enabled?: boolean;
          id?: string;
          intent?: string;
          name?: string;
          plan?: Json;
          updated_at?: string;
          user_id?: string;
          version?: number;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      relay_events: {
        Row: {
          confidence: number;
          created_at: string;
          due_at: string | null;
          id: string;
          kind: Database["public"]["Enums"]["event_kind"];
          provenance: Json;
          source_item_id: string;
          starts_at: string | null;
          summary: string;
          title: string;
          user_id: string;
        };
        Insert: {
          confidence: number;
          created_at?: string;
          due_at?: string | null;
          id?: string;
          kind: Database["public"]["Enums"]["event_kind"];
          provenance: Json;
          source_item_id: string;
          starts_at?: string | null;
          summary: string;
          title: string;
          user_id: string;
        };
        Update: {
          confidence?: number;
          created_at?: string;
          due_at?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["event_kind"];
          provenance?: Json;
          source_item_id?: string;
          starts_at?: string | null;
          summary?: string;
          title?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "relay_events_user_id_source_item_id_fkey";
            columns: ["user_id", "source_item_id"];
            isOneToOne: false;
            referencedRelation: "source_items";
            referencedColumns: ["user_id", "id"];
          },
        ];
      };
      source_facts: {
        Row: {
          certainty: Database["public"]["Enums"]["source_fact_certainty"];
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["source_fact_kind"];
          normalizer_version: number;
          ordinal: number;
          provenance: Json;
          source_item_id: string;
          uncertainty_reason: Database["public"]["Enums"]["source_fact_uncertainty_reason"] | null;
          user_id: string;
          value: Json | null;
        };
        Insert: {
          certainty: Database["public"]["Enums"]["source_fact_certainty"];
          created_at?: string;
          id?: string;
          kind: Database["public"]["Enums"]["source_fact_kind"];
          normalizer_version: number;
          ordinal: number;
          provenance: Json;
          source_item_id: string;
          uncertainty_reason?: Database["public"]["Enums"]["source_fact_uncertainty_reason"] | null;
          user_id: string;
          value?: Json | null;
        };
        Update: {
          certainty?: Database["public"]["Enums"]["source_fact_certainty"];
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["source_fact_kind"];
          normalizer_version?: number;
          ordinal?: number;
          provenance?: Json;
          source_item_id?: string;
          uncertainty_reason?: Database["public"]["Enums"]["source_fact_uncertainty_reason"] | null;
          user_id?: string;
          value?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "source_facts_user_id_source_item_id_fkey";
            columns: ["user_id", "source_item_id"];
            isOneToOne: false;
            referencedRelation: "source_items";
            referencedColumns: ["user_id", "id"];
          },
        ];
      };
      source_items: {
        Row: {
          application_id: string | null;
          attributes: Json;
          captured_at: string;
          connection_id: string | null;
          content_fingerprint: string;
          created_at: string;
          encryption_environment: string | null;
          external_id: string;
          fact_set_fingerprint: string | null;
          id: string;
          key_version: number | null;
          occurred_at: string;
          processed_at: string | null;
          raw_ciphertext: string | null;
          raw_expires_at: string;
          raw_nonce: string | null;
          sender: string | null;
          source: Database["public"]["Enums"]["source_kind"];
          source_account_id: string | null;
          subject: string | null;
          user_id: string;
          wrap_nonce: string | null;
          wrapped_data_key: string | null;
        };
        Insert: {
          application_id?: string | null;
          attributes?: Json;
          captured_at: string;
          connection_id?: string | null;
          content_fingerprint: string;
          created_at?: string;
          encryption_environment?: string | null;
          external_id: string;
          fact_set_fingerprint?: string | null;
          id: string;
          key_version?: number | null;
          occurred_at: string;
          processed_at?: string | null;
          raw_ciphertext?: string | null;
          raw_expires_at?: string;
          raw_nonce?: string | null;
          sender?: string | null;
          source: Database["public"]["Enums"]["source_kind"];
          source_account_id?: string | null;
          subject?: string | null;
          user_id: string;
          wrap_nonce?: string | null;
          wrapped_data_key?: string | null;
        };
        Update: {
          application_id?: string | null;
          attributes?: Json;
          captured_at?: string;
          connection_id?: string | null;
          content_fingerprint?: string;
          created_at?: string;
          encryption_environment?: string | null;
          external_id?: string;
          fact_set_fingerprint?: string | null;
          id?: string;
          key_version?: number | null;
          occurred_at?: string;
          processed_at?: string | null;
          raw_ciphertext?: string | null;
          raw_expires_at?: string;
          raw_nonce?: string | null;
          sender?: string | null;
          source?: Database["public"]["Enums"]["source_kind"];
          source_account_id?: string | null;
          subject?: string | null;
          user_id?: string;
          wrap_nonce?: string | null;
          wrapped_data_key?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "source_items_user_id_connection_id_fkey";
            columns: ["user_id", "connection_id"];
            isOneToOne: false;
            referencedRelation: "connections";
            referencedColumns: ["user_id", "id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      authorize_device_ingress: {
        Args: { p_device_id: string };
        Returns: boolean;
      };
      cas_rewrap_connection_data_key: {
        Args: {
          p_environment: string;
          p_expected_ciphertext: string;
          p_expected_key_version: number;
          p_expected_payload_nonce: string;
          p_expected_wrap_nonce: string;
          p_expected_wrapped_data_key: string;
          p_id: string;
          p_new_key_version: number;
          p_new_wrap_nonce: string;
          p_new_wrapped_data_key: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      cas_rewrap_dead_letter_data_key: {
        Args: {
          p_environment: string;
          p_expected_ciphertext: string;
          p_expected_key_version: number;
          p_expected_payload_nonce: string;
          p_expected_wrap_nonce: string;
          p_expected_wrapped_data_key: string;
          p_id: string;
          p_new_key_version: number;
          p_new_wrap_nonce: string;
          p_new_wrapped_data_key: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      cas_rewrap_source_item_data_key: {
        Args: {
          p_environment: string;
          p_expected_ciphertext: string;
          p_expected_key_version: number;
          p_expected_payload_nonce: string;
          p_expected_wrap_nonce: string;
          p_expected_wrapped_data_key: string;
          p_id: string;
          p_new_key_version: number;
          p_new_wrap_nonce: string;
          p_new_wrapped_data_key: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      claim_dead_letter_replay: {
        Args: { p_id: string; p_request_id: string };
        Returns: {
          accepted_at: string;
          ciphertext: string;
          encryption_aad_envelope_id: string;
          encryption_aad_user_id: string;
          encryption_environment: string;
          envelope_id: string;
          id: string;
          key_version: number;
          nonce: string;
          raw_expires_at: string;
          user_id: string;
          wrap_nonce: string;
          wrapped_data_key: string;
        }[];
      };
      complete_dead_letter_replay: {
        Args: { p_id: string; p_request_id: string; p_result: string };
        Returns: boolean;
      };
      decide_action_run: {
        Args: { p_action_run_id: string; p_decision: string };
        Returns: {
          action_rule_id: string;
          approved_at: string | null;
          attempt_count: number;
          completed_at: string | null;
          created_at: string;
          error_code: string | null;
          error_message: string | null;
          event_id: string;
          id: string;
          input: Json;
          provider: Database["public"]["Enums"]["action_provider"];
          provider_reference: string | null;
          status: Database["public"]["Enums"]["action_status"];
          updated_at: string;
          user_id: string;
          workflow_instance_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "action_runs";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      finalize_account_deletion: {
        Args: { p_user_id: string };
        Returns: {
          attempt_count: number;
          completed_at: string | null;
          connectors_revoked_at: string | null;
          requested_at: string;
          state: Database["public"]["Enums"]["account_deletion_state"];
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "account_deletions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      is_canonical_fact_instant: { Args: { p_value: string }; Returns: boolean };
      kek_encryption_inventory: {
        Args: { p_environment: string };
        Returns: {
          key_version: number;
          row_count: number;
          store: string;
        }[];
      };
      list_dead_letter_items: {
        Args: { p_limit?: number };
        Returns: {
          accepted_at: string;
          completed_at: string;
          envelope_id: string;
          failure_code: string;
          first_failed_at: string;
          id: string;
          key_version: number;
          last_failed_at: string;
          last_replayed_at: string;
          raw_expires_at: string;
          replay_count: number;
          status: string;
        }[];
      };
      mark_account_connectors_revoked: {
        Args: { p_user_id: string };
        Returns: {
          attempt_count: number;
          completed_at: string | null;
          connectors_revoked_at: string | null;
          requested_at: string;
          state: Database["public"]["Enums"]["account_deletion_state"];
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "account_deletions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      own_raw_retention_status: {
        Args: never;
        Returns: {
          earliest_expires_at: string;
          latest_expires_at: string;
          retained_count: number;
        }[];
      };
      persist_encrypted_source_item: {
        Args: {
          p_application_id: string;
          p_captured_at: string;
          p_content_fingerprint: string;
          p_encryption_environment: string;
          p_external_id: string;
          p_id: string;
          p_key_version: number;
          p_occurred_at: string;
          p_raw_ciphertext: string;
          p_raw_nonce: string;
          p_source: Database["public"]["Enums"]["source_kind"];
          p_source_account_id: string;
          p_user_id: string;
          p_wrap_nonce: string;
          p_wrapped_data_key: string;
        };
        Returns: boolean;
      };
      persist_encrypted_source_item_v2: {
        Args: {
          p_accepted_at: string;
          p_application_id: string;
          p_captured_at: string;
          p_content_fingerprint: string;
          p_encryption_environment: string;
          p_external_id: string;
          p_id: string;
          p_key_version: number;
          p_occurred_at: string;
          p_raw_ciphertext: string;
          p_raw_expires_at: string;
          p_raw_nonce: string;
          p_source: Database["public"]["Enums"]["source_kind"];
          p_source_account_id: string;
          p_user_id: string;
          p_wrap_nonce: string;
          p_wrapped_data_key: string;
        };
        Returns: boolean;
      };
      persist_encrypted_source_item_v3: {
        Args: {
          p_accepted_at: string;
          p_application_id: string;
          p_captured_at: string;
          p_content_fingerprint: string;
          p_encryption_environment: string;
          p_external_id: string;
          p_fact_set_fingerprint: string;
          p_id: string;
          p_key_version: number;
          p_occurred_at: string;
          p_raw_ciphertext: string;
          p_raw_expires_at: string;
          p_raw_nonce: string;
          p_source: Database["public"]["Enums"]["source_kind"];
          p_source_account_id: string;
          p_user_id: string;
          p_wrap_nonce: string;
          p_wrapped_data_key: string;
        };
        Returns: string;
      };
      persist_source_facts: {
        Args: {
          p_fact_set_fingerprint: string;
          p_facts: Json;
          p_normalizer_version: number;
          p_source_item_id: string;
          p_user_id: string;
        };
        Returns: string;
      };
      purge_expired_raw_payloads: { Args: { p_now?: string }; Returns: number };
      purge_own_raw_payloads: { Args: never; Returns: number };
      record_dead_letter_item: {
        Args: {
          p_accepted_at: string;
          p_ciphertext: string;
          p_encryption_aad_envelope_id?: string;
          p_encryption_aad_user_id?: string;
          p_encryption_environment: string;
          p_envelope_id: string;
          p_failure_code: string;
          p_id: string;
          p_key_version: number;
          p_nonce: string;
          p_raw_expires_at: string;
          p_replay_request_id: string;
          p_user_id: string;
          p_wrap_nonce: string;
          p_wrapped_data_key: string;
        };
        Returns: boolean;
      };
      register_device: {
        Args: { p_device_id: string; p_platform: string };
        Returns: {
          created_at: string;
          id: string;
          last_seen_at: string | null;
          name: string;
          platform: string;
          public_key: string | null;
          revoked_at: string | null;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "devices";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      release_dead_letter_replay: {
        Args: { p_id: string; p_request_id: string };
        Returns: boolean;
      };
      request_account_deletion: {
        Args: { p_user_id: string };
        Returns: {
          attempt_count: number;
          completed_at: string | null;
          connectors_revoked_at: string | null;
          requested_at: string;
          state: Database["public"]["Enums"]["account_deletion_state"];
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "account_deletions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      request_own_account_deletion: {
        Args: never;
        Returns: {
          attempt_count: number;
          completed_at: string | null;
          connectors_revoked_at: string | null;
          requested_at: string;
          state: Database["public"]["Enums"]["account_deletion_state"];
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "account_deletions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      revoke_device: {
        Args: { p_device_id: string };
        Returns: {
          created_at: string;
          id: string;
          last_seen_at: string | null;
          name: string;
          platform: string;
          public_key: string | null;
          revoked_at: string | null;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "devices";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      account_deletion_state: "requested" | "connectors_revoked" | "completed";
      action_provider: "google-tasks" | "nextcloud-budget" | "webhook";
      action_status:
        | "proposed"
        | "awaiting-approval"
        | "approved"
        | "running"
        | "succeeded"
        | "failed"
        | "cancelled";
      event_kind: "task" | "reminder" | "calendar-event" | "fact";
      source_fact_certainty: "certain" | "uncertain";
      source_fact_kind:
        "sender" | "date" | "amount" | "currency" | "merchant" | "location" | "reference";
      source_fact_uncertainty_reason: "invalid" | "contradictory";
      source_kind: "gmail" | "notification" | "sms" | "email";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      account_deletion_state: ["requested", "connectors_revoked", "completed"],
      action_provider: ["google-tasks", "nextcloud-budget", "webhook"],
      action_status: [
        "proposed",
        "awaiting-approval",
        "approved",
        "running",
        "succeeded",
        "failed",
        "cancelled",
      ],
      event_kind: ["task", "reminder", "calendar-event", "fact"],
      source_fact_certainty: ["certain", "uncertain"],
      source_fact_kind: [
        "sender",
        "date",
        "amount",
        "currency",
        "merchant",
        "location",
        "reference",
      ],
      source_fact_uncertainty_reason: ["invalid", "contradictory"],
      source_kind: ["gmail", "notification", "sms", "email"],
    },
  },
} as const;
