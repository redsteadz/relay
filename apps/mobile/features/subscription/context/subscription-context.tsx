import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";

import { demoModeEnabled } from "@/lib/demo/mode";

import {
  addEntitlementListener,
  configureSubscriptions,
  getCurrentOffering,
  presentCustomerCenter,
  presentPaywall,
  presentPaywallIfNeeded,
  restorePurchases,
  getProEntitlement,
} from "../api/purchases";
import {
  resolveSubscriptionConfiguration,
  subscriptionUnavailableMessage,
  type SubscriptionConfiguration,
} from "../models/configuration";
import { freeEntitlement, type ProEntitlement } from "../models/entitlement";
import { changesEntitlement, type PurchaseOutcome } from "../models/purchaseOutcome";

export const subscriptionQueryKeys = {
  entitlement: ["subscription", "entitlement"] as const,
};

type SubscriptionContextValue = {
  /** The store key could not be resolved; every action is inert and `unavailableMessage` says why. */
  configuration: SubscriptionConfiguration;
  entitlement: ProEntitlement;
  /** True only while the first entitlement read is in flight. */
  loading: boolean;
  openCustomerCenter: () => Promise<boolean>;
  /** Opens RevenueCat's paywall unconditionally. */
  openPaywall: () => Promise<PurchaseOutcome>;
  /** Opens it only when Relay Pro is not already active. */
  openPaywallIfNeeded: () => Promise<PurchaseOutcome>;
  /** True when Relay Pro is active. Never true as a result of a failure. */
  pro: boolean;
  refresh: () => Promise<void>;
  restore: () => Promise<PurchaseOutcome>;
  unavailableMessage: string | undefined;
};

const SubscriptionContext = createContext<SubscriptionContextValue | undefined>(undefined);

/**
 * Relay Pro, for every screen that asks.
 *
 * A provider rather than a hook per screen because configuring the SDK, holding the store's
 * entitlement listener, and answering "is this person a subscriber" all have to be the same
 * instance. Two independent copies would mean two configure calls and a settings screen that
 * disagrees with a gate rendered beside it.
 *
 * Nothing here can block the app. The configuration resolves to inert in a demo build, on web, and
 * when no key is present; every read failure resolves to the free tier. That is deliberate: Relay's
 * local loop does not need a store, so a RevenueCat outage must cost a subscriber their Pro
 * features at worst, never their app.
 */
export function SubscriptionProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [configuration] = useState<SubscriptionConfiguration>(() =>
    resolveSubscriptionConfiguration({
      androidApiKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
      demo: demoModeEnabled(),
      iosApiKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
      platformOS: Platform.OS,
    }),
  );
  // Configured during render of the provider rather than in an effect, so the first entitlement read
  // below cannot race ahead of it. `configureSubscriptions` is idempotent and returns synchronously.
  const [active] = useState(() => configureSubscriptions(configuration));

  const entitlementQuery = useQuery({
    enabled: active,
    queryFn: getProEntitlement,
    queryKey: subscriptionQueryKeys.entitlement,
    // The listener below is the live signal; this is the cold-start read.
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!active) return;
    return addEntitlementListener((entitlement) => {
      queryClient.setQueryData(subscriptionQueryKeys.entitlement, entitlement);
    });
  }, [active, queryClient]);

  const refresh = useCallback(async () => {
    if (!active) return;
    await queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.entitlement });
  }, [active, queryClient]);

  const openPaywall = useCallback(async () => {
    const offering = await getCurrentOffering();
    const outcome = await presentPaywall(offering);
    if (changesEntitlement(outcome)) await refresh();
    return outcome;
  }, [refresh]);

  const openPaywallIfNeeded = useCallback(async () => {
    const offering = await getCurrentOffering();
    const outcome = await presentPaywallIfNeeded(offering);
    if (changesEntitlement(outcome)) await refresh();
    return outcome;
  }, [refresh]);

  const restore = useCallback(async () => {
    const { entitlement, outcome } = await restorePurchases();
    if (changesEntitlement(outcome)) {
      queryClient.setQueryData(subscriptionQueryKeys.entitlement, entitlement);
    }
    return outcome;
  }, [queryClient]);

  const openCustomerCenter = useCallback(async () => {
    const presented = await presentCustomerCenter();
    // The person may have cancelled or changed plan while it was open.
    if (presented) await refresh();
    return presented;
  }, [refresh]);

  const entitlement = entitlementQuery.data ?? freeEntitlement;
  const value = useMemo<SubscriptionContextValue>(
    () => ({
      configuration,
      entitlement,
      loading: active && entitlementQuery.isPending,
      openCustomerCenter,
      openPaywall,
      openPaywallIfNeeded,
      pro: entitlement.active,
      refresh,
      restore,
      unavailableMessage: subscriptionUnavailableMessage(configuration),
    }),
    [
      active,
      configuration,
      entitlement,
      entitlementQuery.isPending,
      openCustomerCenter,
      openPaywall,
      openPaywallIfNeeded,
      refresh,
      restore,
    ],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription(): SubscriptionContextValue {
  const value = useContext(SubscriptionContext);
  if (value === undefined) {
    throw new Error("useSubscription must be used inside a SubscriptionProvider");
  }
  return value;
}

/**
 * Just the answer, for a caller that only needs to branch.
 *
 * Never true because something failed: `entitlement` resolves to the free tier on every error path.
 */
export function useRelayPro(): boolean {
  return useSubscription().pro;
}
