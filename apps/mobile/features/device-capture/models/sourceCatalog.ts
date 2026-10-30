export type SourceId = "gmail" | "notifications" | "sms";

export type SourceDefinition = {
  description: string;
  icon: string;
  id: SourceId;
  name: string;
};

export const sourceCatalog: Record<SourceId, SourceDefinition> = {
  gmail: {
    description: "Restricted-scope mailbox events with minimized delivery.",
    icon: "email-outline",
    id: "gmail",
    name: "Gmail",
  },
  notifications: {
    description: "Notifications from apps your rules name.",
    icon: "bell-outline",
    id: "notifications",
    name: "Android notifications",
  },
  sms: {
    description: "Incoming SMS from selected contacts in sideload builds.",
    icon: "message-text-outline",
    id: "sms",
    name: "Android SMS",
  },
};

export const gmailDisclosure =
  "Gmail is designed around restricted scopes. Google Pub/Sub delivers mailbox cursors to Relay, not message bodies. The connection flow is not available in this build.";

export function notificationDisclosure(developmentLocal: boolean): string {
  return `Relay reads the title and visible text of notifications only from apps you name in a rule or choose in Sources. It ${
    developmentLocal
      ? "encrypts matching fields in a separate on-device diagnostic queue and does not upload them"
      : "encrypts matching fields on this device and uploads them to your Relay account"
  }. Raw server payloads are deleted after seven days. Relay never uploads the full extras bundle, and it clears a notification only when a quiet rule you allowed says to.`;
}

export function smsDisclosure(developmentLocal: boolean): string {
  return `Relay reads incoming SMS only from contacts you select, including the sender, message body, and received time. Matching messages are encrypted on this device and ${
    developmentLocal
      ? "remain only in a local diagnostic queue. They are not uploaded"
      : "are uploaded to your Relay account and deleted from raw server storage after seven days"
  }. Relay does not read your contact list or outgoing messages. This access exists only in the internal sideload build.`;
}
