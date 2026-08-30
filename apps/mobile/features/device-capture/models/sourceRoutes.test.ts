import { describe, expect, it } from "vitest";

import {
  sourceConfigurationRoute,
  sourceQueueItemRoute,
  sourceQueueRoutes,
  sourceSelectorRoutes,
} from "./sourceRoutes";

describe("source routes", () => {
  it("keeps each overview row mapped to its focused configuration route", () => {
    expect(sourceConfigurationRoute("gmail")).toBe("/sources/gmail");
    expect(sourceConfigurationRoute("notifications")).toBe("/sources/notifications");
    expect(sourceConfigurationRoute("sms")).toBe("/sources/sms");
  });

  it("maps selectors and queues without changing the connections tab route", () => {
    expect(sourceSelectorRoutes).toEqual({
      notifications: "/sources/notifications/apps",
      sms: "/sources/sms/contacts",
    });
    expect(sourceQueueRoutes).toEqual({
      notifications: "/sources/notifications/queue",
      sms: "/sources/sms/queue",
    });
    expect(sourceQueueItemRoute("notifications", "evt-1")).toEqual({
      params: { id: "evt-1" },
      pathname: "/sources/notifications/queue/[id]",
    });
    expect(sourceQueueItemRoute("sms", "sms-1")).toEqual({
      params: { id: "sms-1" },
      pathname: "/sources/sms/queue/[id]",
    });
  });
});
