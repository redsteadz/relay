import type { SourceId } from "./sourceCatalog";

export const sourceConfigurationRoutes = {
  gmail: "/sources/gmail",
  notifications: "/sources/notifications",
  sms: "/sources/sms",
} as const;

export const sourceSelectorRoutes = {
  notifications: "/sources/notifications/apps",
  sms: "/sources/sms/contacts",
} as const;

export const sourceQueueRoutes = {
  notifications: "/sources/notifications/queue",
  sms: "/sources/sms/queue",
} as const;

export function sourceConfigurationRoute(source: SourceId) {
  return sourceConfigurationRoutes[source];
}

export function sourceQueueItemRoute(source: "notifications" | "sms", id: string) {
  return source === "notifications"
    ? { params: { id }, pathname: "/sources/notifications/queue/[id]" as const }
    : { params: { id }, pathname: "/sources/sms/queue/[id]" as const };
}
