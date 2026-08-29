import type { Category } from "@relay/contracts";

import { CategoryError } from "@/lib/categories";

export function categoryErrorMessage(error: unknown): string {
  if (!(error instanceof CategoryError))
    return "Categories are unavailable. Check your connection and retry.";
  if (error.reason === "duplicate-name") {
    return "A category with that name or stable slug already exists. Names ignore case and extra spacing.";
  }
  if (error.reason === "archive-required") {
    return "This category explains existing history, so it must remain archived instead of being deleted.";
  }
  if (error.reason === "protected-system-category") {
    return "System categories are protected and cannot be changed or removed.";
  }
  return "Categories are unavailable. Check your connection and retry.";
}

export function categoryEditorDefaults(category: Category | null) {
  return {
    description: category?.description ?? "",
    name: category?.name ?? "",
    quietByDefault: category?.quietByDefault ?? false,
    slug: category?.slug ?? "",
  };
}
