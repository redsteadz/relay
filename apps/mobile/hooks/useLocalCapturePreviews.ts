import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import RelayDeviceIngress from "@/modules/relay-device-ingress";
import { logMobileError, runInBackground } from "@/lib/observability";

const LOCAL_QUEUE_POLL_MS = 3_000;

type LocalCapturePreviewState<T> = {
  captures: T[];
  error: string | undefined;
  refresh: () => void;
  refreshing: boolean;
};

export function useSecureLocalCaptureScreen(enabled: boolean) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const generationRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) {
        setReady(false);
        setError(undefined);
        return undefined;
      }

      let focused = true;
      let foreground = AppState.currentState === "active";
      let secureWindowEnabled = false;
      const generation = ++generationRef.current;

      const activate = () => {
        if (focused && foreground && secureWindowEnabled) setReady(true);
      };

      setReady(false);
      setError(undefined);
      void RelayDeviceIngress.setCapturePreviewSecure(true)
        .then(() => {
          if (!focused || generationRef.current !== generation) return;
          secureWindowEnabled = true;
          activate();
        })
        .catch((error: unknown) => {
          logMobileError("capture.secure_preview_enable_failed", error, {
            code: "SECURE_PREVIEW_ENABLE_FAILED",
            integration: "relay-device-ingress",
            operation: "setCapturePreviewSecure",
          });
          if (!focused || generationRef.current !== generation) return;
          setReady(false);
          setError("Secure local preview is unavailable.");
        });

      const subscription = AppState.addEventListener("change", (state) => {
        foreground = state === "active";
        if (foreground) activate();
        else setReady(false);
      });

      return () => {
        focused = false;
        secureWindowEnabled = false;
        setReady(false);
        setError(undefined);
        subscription.remove();
        const cleanupGeneration = ++generationRef.current;
        requestAnimationFrame(() => {
          if (generationRef.current !== cleanupGeneration) return;
          runInBackground(
            RelayDeviceIngress.setCapturePreviewSecure(false),
            "capture.secure_preview_disable_failed",
            {
              code: "SECURE_PREVIEW_DISABLE_FAILED",
              integration: "relay-device-ingress",
              operation: "setCapturePreviewSecure",
            },
          );
        });
      };
    }, [enabled]),
  );

  return { error, ready };
}

export function useLocalCapturePreviews<T>({
  enabled,
  errorMessage,
  load,
}: {
  enabled: boolean;
  errorMessage: string;
  load: () => Promise<T[]>;
}): LocalCapturePreviewState<T> {
  const [captures, setCaptures] = useState<T[]>([]);
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const lifecycleRef = useRef({ active: false, generation: 0 });
  const refreshRunningRef = useRef(false);
  const refreshPendingRef = useRef(false);

  const clear = useCallback(() => {
    lifecycleRef.current.active = false;
    lifecycleRef.current.generation += 1;
    refreshPendingRef.current = false;
    setCaptures([]);
    setError(undefined);
    setRefreshing(false);
  }, []);

  const refresh = useCallback(() => {
    if (!lifecycleRef.current.active) return;
    if (refreshRunningRef.current) {
      refreshPendingRef.current = true;
      return;
    }

    refreshRunningRef.current = true;
    void (async () => {
      try {
        do {
          refreshPendingRef.current = false;
          if (!lifecycleRef.current.active) break;
          const generation = lifecycleRef.current.generation;
          setRefreshing(true);
          setError(undefined);
          try {
            const nextCaptures = await load();
            if (lifecycleRef.current.active && lifecycleRef.current.generation === generation) {
              setCaptures(nextCaptures);
            }
          } catch (error: unknown) {
            logMobileError("capture.local_preview_load_failed", error, {
              code: "LOCAL_CAPTURE_PREVIEW_LOAD_FAILED",
              integration: "relay-device-ingress",
              operation: "loadLocalCapturePreviews",
            });
            if (lifecycleRef.current.active && lifecycleRef.current.generation === generation) {
              setCaptures([]);
              setError(errorMessage);
            }
          }
        } while (refreshPendingRef.current && lifecycleRef.current.active);
      } finally {
        refreshRunningRef.current = false;
        if (lifecycleRef.current.active) setRefreshing(false);
      }
    })();
  }, [errorMessage, load]);

  useEffect(() => {
    if (!enabled) {
      clear();
      return undefined;
    }

    lifecycleRef.current.active = true;
    lifecycleRef.current.generation += 1;
    refresh();
    const interval = setInterval(refresh, LOCAL_QUEUE_POLL_MS);
    return () => {
      clearInterval(interval);
      clear();
    };
  }, [clear, enabled, refresh]);

  return { captures, error, refresh, refreshing };
}
