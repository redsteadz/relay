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

    await sendDemoIngress("synthetic-bearer-credential");

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/ingest", {
      body: JSON.stringify(demoIngress),
      headers: {
        authorization: "Bearer synthetic-bearer-credential",
        "content-type": "application/json",
      },
      method: "POST",
    });
  });
});
