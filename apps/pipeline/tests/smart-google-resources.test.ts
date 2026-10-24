import { describe, expect, it, vi } from "vitest";
vi.mock("../src/smart-automations", () => ({
  smartGoogleAccessToken: () => Promise.resolve("synthetic-access"),
}));
import type { SmartAutomationRepository } from "../src/smart-automations";
import { smartGoogleResources, validateSmartExpenseSheet } from "../src/smart-google-resources";

function repository(body: unknown): SmartAutomationRepository {
  return {
    fetcher: vi.fn(() => Promise.resolve(Response.json(body))),
  } as unknown as SmartAutomationRepository;
}
describe("Google destination discovery (mocked HTTP)", () => {
  it("offers owned calendars only", async () => {
    const repo = repository({
      items: [
        { id: "owned", summary: "Personal", accessRole: "owner" },
        { id: "shared", summary: "Shared", accessRole: "writer" },
      ],
    });
    expect(await smartGoogleResources(repo, "synthetic-user", "google-calendar")).toEqual([
      { id: "owned", label: "Personal" },
    ]);
  });
  it("refuses malformed destination identities", async () => {
    await expect(
      smartGoogleResources(
        repository({ items: [{ title: "Invalid" }] }),
        "synthetic-user",
        "google-tasks",
      ),
    ).rejects.toThrow();
  });
  it("refuses incomplete pagination rather than silently offering a partial list", async () => {
    const repo = repository({ items: [], nextPageToken: "more" });
    await expect(smartGoogleResources(repo, "synthetic-user", "google-tasks")).rejects.toThrow(
      "review limit",
    );
    expect(repo.fetcher).toHaveBeenCalledTimes(10);
  });
  it("validates an existing spreadsheet's managed header without writing", async () => {
    const repo = repository({
      values: [
        ["Relay action", "Occurred at", "Merchant", "Amount", "Currency", "Reference", "Source"],
      ],
    });
    await validateSmartExpenseSheet(repo, "synthetic-user", "synthetic-sheet");
    expect(repo.fetcher).toHaveBeenCalledOnce();
    const call = vi.mocked(repo.fetcher).mock.calls[0];
    expect(call?.[1]?.method).toBeUndefined();
  });
  it("refuses an unrelated spreadsheet header", async () => {
    await expect(
      validateSmartExpenseSheet(
        repository({ values: [["Personal data"]] }),
        "synthetic-user",
        "synthetic-sheet",
      ),
    ).rejects.toThrow("expected header");
  });
});
