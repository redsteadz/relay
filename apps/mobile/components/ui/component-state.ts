export type ButtonTone = "primary" | "secondary" | "destructive";
export type MessageTone = "info" | "success" | "warning" | "error";

export function getButtonState(tone: ButtonTone, disabled: boolean, loading: boolean) {
  return {
    destructive: tone === "destructive",
    inactive: disabled || loading,
    accessibilityState: {
      busy: loading,
      disabled: disabled || loading,
    },
  } as const;
}

export function getMessageState(tone: MessageTone) {
  return {
    accessibilityRole: tone === "error" ? "alert" : undefined,
    liveRegion: tone === "error" ? "assertive" : "polite",
  } as const;
}
