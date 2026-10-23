import { QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { loadNodeSqlite, nodeSqliteLocalStore } from "./local-store/node-sqlite";
import { finishCaptureSignOut } from "./capture-logout";
import { resumeCaptureWork } from "./capture-work";
import { clearRelaySession } from "./auth";

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("./local-store/driver", () => ({ openSqliteDatabase: vi.fn() }));
const { clearLocalStoreTenant } = await import("./local-store/database");
const sqlite = await loadNodeSqlite();

describe.skipIf(sqlite === undefined)("logout with real local SQLite and query cache", () => {
  it("clears only the departing tenant's rows, cancels cache reads, and uses local auth sign-out", async () => {
    if (sqlite === undefined) throw new Error("node:sqlite unavailable");
    const { store, close } = nodeSqliteLocalStore(sqlite);
    const cache = new QueryClient();
    try {
      for (const tenant of ["account-a", "account-b"]) {
        await store.runAsync(
          "INSERT INTO source_items (tenant_id,id,source,occurred_at,captured_at,created_at) VALUES (?,?,'sms',?,?,?)",
          [
            tenant,
            "same-capture-id",
            "2026-10-23T00:00:00Z",
            "2026-10-23T00:00:00Z",
            "2026-10-23T00:00:00Z",
          ],
        );
        cache.setQueryData(["inbox", tenant], [{ title: `synthetic-${tenant}` }]);
      }
      const signOut = vi.fn().mockResolvedValue({ error: null });
      const serverAccess = vi.fn(() => {
        throw new Error("Logout must not access server tables");
      });
      const client = { auth: { signOut }, from: serverAccess } as unknown as SupabaseClient;
      await finishCaptureSignOut("account-a", false, {
        prepare: vi.fn().mockResolvedValue(undefined),
        finishCaptures: vi.fn().mockResolvedValue(0),
        clearDerived: (tenant) => clearLocalStoreTenant(store, tenant),
        clearCaches: async () => {
          await cache.cancelQueries();
          cache.clear();
        },
        clearSession: () => clearRelaySession(client),
      });
      expect(
        await store.getAllAsync("SELECT id FROM source_items WHERE tenant_id=?", ["account-a"]),
      ).toEqual([]);
      expect(
        await store.getAllAsync("SELECT id FROM source_items WHERE tenant_id=?", ["account-b"]),
      ).toHaveLength(1);
      expect(cache.getQueryCache().getAll()).toEqual([]);
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(serverAccess).not.toHaveBeenCalled();
    } finally {
      resumeCaptureWork("account-a");
      cache.clear();
      close();
    }
  });
});
