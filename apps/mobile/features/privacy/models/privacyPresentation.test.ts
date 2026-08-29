import { describe, expect, it } from "vitest";

import { RelayApiError } from "@/lib/relay-api";

import { formatPrivacyDate, privacyErrorMessage } from "./privacyPresentation";

describe("privacy presentation", () => {
  it("maps transport state to fixed, non-sensitive copy", () => {
    expect(privacyErrorMessage(new RelayApiError("unauthorized"))).toContain("session expired");
    expect(privacyErrorMessage(new Error("raw database detail"))).not.toContain("database detail");
  });

  it("makes an empty cleanup schedule explicit", () => {
    expect(formatPrivacyDate(null)).toBe("None scheduled");
    expect(formatPrivacyDate("not-a-date")).toBe("Unavailable");
  });
});
