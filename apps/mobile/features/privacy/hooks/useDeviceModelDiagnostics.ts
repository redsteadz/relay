import { useCallback, useEffect, useState } from "react";

import { useFocusEffect } from "expo-router";

import { resolvePendingSilencesForTenant } from "@/features/silence/api/silenceResolution";
import { useAuth } from "@/lib/auth-context";
import type { DeviceSemanticResult } from "@/lib/device-semantic";
import {
  clearDeviceModelJournal,
  probeDeviceModel,
  readDeviceModelJournal,
  subscribeDeviceModelJournal,
  type DeviceModelPassReport,
} from "@/lib/device-semantic-diagnostics";
import {
  deviceDisclosures,
  localStoreSupported,
  openLocalStore,
  type StoredDeviceDisclosure,
} from "@/lib/local-store";
import { logMobileError } from "@/lib/observability";
import RelayDeviceIngress, { type DeviceCapabilities } from "@/modules/relay-device-ingress";

import { useDeviceModel } from "./useDeviceModel";

/** How many device disclosures the diagnostics screen reads. The history screen has the rest. */
const RECENT_DISCLOSURES = 20;

/**
 * The journal alone, newest first, kept current as passes write to it.
 *
 * For a screen that needs one answer -- what did the last quiet pass do -- rather than the whole
 * diagnostics page. The rule editor uses it to explain a verdict that says "waiting".
 */
export function useDeviceModelJournal(tenantId: string | undefined): DeviceModelPassReport[] {
  const [passes, setPasses] = useState<DeviceModelPassReport[]>([]);
  useEffect(() => {
    if (tenantId === undefined) {
      setPasses([]);
      return;
    }
    let active = true;
    const load = () => {
      void readDeviceModelJournal(tenantId).then((journal) => {
        if (active) setPasses(journal);
      });
    };
    load();
    const unsubscribe = subscribeDeviceModelJournal(tenantId, load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [tenantId]);
  return passes;
}

/**
 * Everything the device model path can say about itself, for one screen.
 *
 * Three sources, read together because a reader needs all three to answer "why did nothing happen":
 * the journal says what each pass did and why it stopped, the disclosure table says what each
 * request sent and got back, and the live capabilities say whether the listener that feeds both is
 * connected right now. The two actions ask the model a synthetic question and run the quiet pass by
 * hand, which are the two experiments a reader would otherwise have to wait fifteen minutes for.
 */
export function useDeviceModelDiagnostics(tenantId: string | undefined) {
  const { client } = useAuth();
  const model = useDeviceModel(tenantId);
  const [passes, setPasses] = useState<DeviceModelPassReport[]>([]);
  const [disclosures, setDisclosures] = useState<StoredDeviceDisclosure[]>([]);
  const [capabilities, setCapabilities] = useState<DeviceCapabilities>();
  const [probeResult, setProbeResult] = useState<DeviceSemanticResult>();
  const [probing, setProbing] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastPassActed, setLastPassActed] = useState<number>();

  const refresh = useCallback(async () => {
    if (tenantId === undefined) return;
    const [journal, rows, state] = await Promise.all([
      readDeviceModelJournal(tenantId),
      localStoreSupported()
        ? openLocalStore()
            .then((database) => deviceDisclosures(database, tenantId, RECENT_DISCLOSURES))
            .catch((error: unknown) => {
              logMobileError("semantic.diagnostics_disclosures_unreadable", error, {
                code: "DEVICE_MODEL_DIAGNOSTICS_DISCLOSURES_UNREADABLE",
                integration: "expo-sqlite",
                operation: "deviceDisclosures",
              });
              return [] as StoredDeviceDisclosure[];
            })
        : Promise.resolve([] as StoredDeviceDisclosure[]),
      RelayDeviceIngress.getCapabilities().catch((error: unknown) => {
        logMobileError("semantic.diagnostics_capabilities_unreadable", error, {
          code: "DEVICE_MODEL_DIAGNOSTICS_CAPABILITIES_UNREADABLE",
          integration: "relay-device-ingress",
          operation: "getCapabilities",
        });
        return undefined;
      }),
    ]);
    setPasses(journal);
    setDisclosures(rows);
    setCapabilities(state);
  }, [tenantId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    if (tenantId === undefined) return;
    return subscribeDeviceModelJournal(tenantId, () => {
      void refresh();
    });
  }, [refresh, tenantId]);

  /** One synthetic question to the configured model. Discloses nothing a reader received. */
  const probe = useCallback(async () => {
    if (tenantId === undefined) return;
    setProbing(true);
    try {
      setProbeResult(await probeDeviceModel(tenantId, model.config));
    } finally {
      setProbing(false);
    }
  }, [model.config, tenantId]);

  /** The same pass the app runs on open and in the background, started now and reported here. */
  const runQuietPass = useCallback(async () => {
    if (tenantId === undefined || client === undefined) return;
    setRunning(true);
    try {
      setLastPassActed(
        await resolvePendingSilencesForTenant(client, tenantId, { trigger: "manual" }),
      );
    } catch (error: unknown) {
      logMobileError("semantic.diagnostics_quiet_pass_failed", error, {
        code: "DEVICE_MODEL_DIAGNOSTICS_QUIET_PASS_FAILED",
        integration: "relay-device-ingress",
        operation: "resolvePendingSilencesForTenant",
      });
    } finally {
      setRunning(false);
    }
  }, [client, tenantId]);

  const clear = useCallback(async () => {
    if (tenantId === undefined) return;
    await clearDeviceModelJournal(tenantId);
    setProbeResult(undefined);
    setLastPassActed(undefined);
  }, [tenantId]);

  return {
    canRunPass: client !== undefined,
    capabilities,
    clear,
    config: model.config,
    disclosures,
    lastPassActed,
    loading: model.loading,
    passes,
    probe,
    probeResult,
    probing,
    refresh,
    runQuietPass,
    running,
  };
}
