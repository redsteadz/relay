import type { PrivacyDisclosure } from "@relay/contracts";
import { StyleSheet, View } from "react-native";
import { Chip, Surface } from "react-native-paper";

import { AppText } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import { formatPrivacyDate } from "../models/privacyPresentation";

export function DisclosureCard({ disclosure }: { disclosure: PrivacyDisclosure }) {
  const theme = useRelayTheme();
  return (
    <Surface
      elevation={theme.relay.elevation.flat}
      style={[
        {
          backgroundColor: theme.relay.colors.surface,
          borderColor: theme.relay.colors.border,
          borderWidth: theme.relay.borders.hairline,
          borderRadius: theme.relay.radii.lg,
          gap: theme.relay.spacing.md,
          padding: theme.relay.spacing.lg,
        },
      ]}
    >
      <View style={[styles.heading, { gap: theme.relay.spacing.sm }]}>
        <View style={styles.copy}>
          <AppText variant="title">{disclosure.purpose}</AppText>
          <AppText tone="muted" variant="caption">
            {formatPrivacyDate(disclosure.createdAt)}
          </AppText>
        </View>
        <Chip compact>{disclosure.provider}</Chip>
      </View>
      <AppText tone="muted">Model: {disclosure.model}</AppText>
      <View style={[styles.fields, { gap: theme.relay.spacing.sm }]}>
        {disclosure.disclosedFields.map((field) => (
          <Chip compact key={field}>
            {field}
          </Chip>
        ))}
      </View>
      <AppText tone="muted" variant="caption">
        Relay records field names and purpose only. It never stores the prompt or source content.
      </AppText>
    </Surface>
  );
}

const styles = StyleSheet.create({
  copy: { flex: 1 },
  fields: { flexDirection: "row", flexWrap: "wrap" },
  heading: { alignItems: "flex-start", flexDirection: "row" },
});
