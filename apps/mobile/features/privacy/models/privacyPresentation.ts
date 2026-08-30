import { RelayApiError } from "@/lib/relay-api";

export function privacyErrorMessage(error: unknown): string {
  if (error instanceof RelayApiError) {
    if (error.reason === "not-configured") {
      return "This privacy control is not configured on the current Relay deployment.";
    }
    if (error.reason === "unauthorized") return "Your session expired. Sign in again to continue.";
    if (error.reason === "rate-limit") return "Too many requests. Please try again shortly.";
    if (error.reason === "network" || error.reason === "timeout") {
      return "The service is temporarily unreachable. Please try again.";
    }
  }
  return "This privacy control is temporarily unavailable. Check your connection and retry.";
}

export function formatPrivacyDate(value: string | null | undefined): string {
  if (value === null || value === undefined) return "None scheduled";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return parsed.toLocaleString();
}
