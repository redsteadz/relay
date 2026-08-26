import { afterEach, describe, expect, it, vi } from "vitest";

import { demoIngress, sendDemoIngress } from "./demo";

describe("sendDemoIngress", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the verified mobile bearer session without a development identity header", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ accepted: true, id: demoIngress.id }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendDemoIngress("synthetic-bearer-credential", "19784902-e7a4-4f7f-b04d-e3a78c876629");

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/ingest", {
      body: JSON.stringify({
        deviceId: "19784902-e7a4-4f7f-b04d-e3a78c876629",
        envelope: demoIngress,
      }),
      headers: {
        authorization: "Bearer synthetic-bearer-credential",
        "content-type": "application/json",
      },
      method: "POST",
    });
  });
});
