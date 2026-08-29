import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deleteRelayAccount,
  getDisclosureHistory,
  getOpenAiStatus,
  getPrivacyOverview,
  purgeRawPayloads,
  revokeOpenAiKey,
} from "../api/privacy";

export const privacyQueryKeys = {
  disclosures: (userId: string | undefined) => ["privacy", userId, "disclosures"] as const,
  openAi: (userId: string | undefined) => ["privacy", userId, "openai"] as const,
  overview: (userId: string | undefined) => ["privacy", userId, "overview"] as const,
};

export function usePrivacySettings(userId: string | undefined, accessToken: string | undefined) {
  const queryClient = useQueryClient();
  const overview = useQuery({
    enabled: accessToken !== undefined,
    queryFn: () => getPrivacyOverview(accessToken as string),
    queryKey: privacyQueryKeys.overview(userId),
  });
  const openAi = useQuery({
    enabled: accessToken !== undefined,
    queryFn: () => getOpenAiStatus(accessToken as string),
    queryKey: privacyQueryKeys.openAi(userId),
  });
  const purge = useMutation({
    mutationFn: () => purgeRawPayloads(accessToken as string),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: privacyQueryKeys.overview(userId) }),
  });
  const revoke = useMutation({
    mutationFn: () => revokeOpenAiKey(accessToken as string),
    onSuccess: (status) => queryClient.setQueryData(privacyQueryKeys.openAi(userId), status),
  });
  const deletion = useMutation({ mutationFn: () => deleteRelayAccount(accessToken as string) });

  return {
    deleteAccount: deletion.mutateAsync,
    deletion,
    openAi,
    overview,
    purge,
    purgeRawPayloads: purge.mutateAsync,
    revoke,
    revokeOpenAiKey: revoke.mutateAsync,
  };
}

export function useDisclosureHistory(userId: string | undefined, accessToken: string | undefined) {
  return useQuery({
    enabled: accessToken !== undefined,
    queryFn: () => getDisclosureHistory(accessToken as string),
    queryKey: privacyQueryKeys.disclosures(userId),
  });
}
