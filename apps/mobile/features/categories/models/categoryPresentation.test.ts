import { describe, expect, it } from "vitest";

import { CategoryError } from "@/lib/categories";

import { categoryEditorDefaults, categoryErrorMessage } from "./categoryPresentation";

describe("category presentation", () => {
  it("never reflects database messages into the interface", () => {
    const error = new CategoryError("duplicate-name");
    expect(categoryErrorMessage(error)).toContain("already exists");
    expect(categoryErrorMessage(error)).not.toContain(error.message);
  });

  it("maps absent optional values to controlled form defaults", () => {
    expect(
      categoryEditorDefaults({
        id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
        isSystem: false,
        name: "Work",
        quietByDefault: true,
        slug: "work",
        sortOrder: 2,
      }),
    ).toEqual({ description: "", name: "Work", quietByDefault: true, slug: "work" });
  });
});
