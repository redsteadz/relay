import { useCallback, useEffect, useState } from "react";

import type { DeviceSemanticConfig } from "@relay/contracts";

import {
  clearDeviceSemanticConfig,
  readDeviceSemanticConfig,
  writeDeviceSemanticConfig,
} from "@/lib/device-semantic-config";
import { reportUnexpectedUiError } from "@/lib/observability";

import {
  deviceModelConfigFrom,
  type DeviceModelFormValues,
} from "../models/deviceModelPresentation";

/**
 * The model endpoint stored on this phone.
 *
 * Not a react-query resource. It is device-local rather than account-backed, nothing else reads it,
 * and it has no server state to keep in step -- so a cache keyed by tenant would be machinery around
 * one keychain entry. See [ADR-0019](../../../../docs/decisions/0019-device-semantic-evaluation.md).
 */
export function useDeviceModel(tenantId: string | undefined) {
  const [config, setConfig] = useState<DeviceSemanticConfig>();
  const [loading, setLoading] = useState(tenantId !== undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    if (tenantId === undefined) {
      setConfig(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setConfig(await readDeviceSemanticConfig(tenantId));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Stores the endpoint, keeping the existing key when the field was left blank.
   *
   * Blank-means-keep is the same convention the server panel uses, and it is what lets a reader
   * change a model or an address without retyping a key they cannot see.
   */
  const save = useCallback(
    async (values: DeviceModelFormValues) => {
      if (tenantId === undefined) return;
      setSaving(true);
      setSaveError(null);
      try {
        const next = deviceModelConfigFrom(values);
        const retained =
          next.apiKey === undefined && config?.apiKey !== undefined
            ? { ...next, apiKey: config.apiKey }
            : next;
        setConfig(await writeDeviceSemanticConfig(tenantId, retained));
      } catch (error: unknown) {
        reportUnexpectedUiError(error, "ui.device_model_save_failed", {
          code: "DEVICE_MODEL_SAVE_FAILED",
          integration: "device-semantic",
          operation: "writeDeviceSemanticConfig",
        });
        setSaveError(error);
      } finally {
        setSaving(false);
      }
    },
    [config?.apiKey, tenantId],
  );

  /** Forgets this device's endpoint. The server's credential is separate and is untouched. */
  const remove = useCallback(async () => {
    if (tenantId === undefined) return;
    setSaving(true);
    try {
      await clearDeviceSemanticConfig(tenantId);
      setConfig(undefined);
    } finally {
      setSaving(false);
    }
  }, [tenantId]);

  return { config, loading, refresh, remove, save, saveError, saving };
}
