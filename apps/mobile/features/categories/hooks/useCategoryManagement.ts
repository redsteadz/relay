import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Category, CategoryCreateRequest } from "@relay/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createCategory, deleteCategory, listCategories, updateCategory } from "@/lib/categories";

type CategoryAction = {
  categoryId?: string;
  run: () => Promise<void>;
};

function queryKey(userId: string | undefined) {
  return ["categories", userId] as const;
}

export function useCategoryManagement(
  client: SupabaseClient | undefined,
  userId: string | undefined,
) {
  const queryClient = useQueryClient();
  const query = useQuery({
    enabled: client !== undefined && userId !== undefined,
    queryFn: () => listCategories(client as SupabaseClient, { includeArchived: true }),
    queryKey: queryKey(userId),
  });
  const mutation = useMutation({
    mutationFn: (action: CategoryAction) => action.run(),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: queryKey(userId) }),
  });

  const categories = query.data ?? [];
  const activeCustom = categories.filter(
    (category) => !category.isSystem && category.archivedAt === undefined,
  );

  function run(action: CategoryAction) {
    mutation.reset();
    return mutation.mutateAsync(action);
  }

  return {
    activeCustom,
    archivedCustom: categories.filter(
      (category) => !category.isSystem && category.archivedAt !== undefined,
    ),
    clearError: mutation.reset,
    create: (request: CategoryCreateRequest) =>
      run({
        run: async () => {
          if (client === undefined || userId === undefined) throw new Error("Not authenticated");
          await createCategory(client, userId, {
            ...request,
            sortOrder: activeCustom.length,
          });
        },
      }),
    error: mutation.error ?? query.error,
    isLoading: query.isFetching && query.data === undefined,
    isMutating: mutation.isPending,
    loadError: query.error,
    move: (category: Category, direction: -1 | 1) => {
      const currentIndex = activeCustom.findIndex((item) => item.id === category.id);
      const targetIndex = currentIndex + direction;
      if (client === undefined || targetIndex < 0 || targetIndex >= activeCustom.length) {
        return Promise.resolve();
      }
      const reordered = [...activeCustom];
      const [moved] = reordered.splice(currentIndex, 1);
      if (moved === undefined) return Promise.resolve();
      reordered.splice(targetIndex, 0, moved);
      return run({
        categoryId: category.id,
        run: async () => {
          await Promise.all(
            reordered.map((item, index) =>
              item.sortOrder === index
                ? Promise.resolve()
                : updateCategory(client, item.id, { sortOrder: index }),
            ),
          );
        },
      });
    },
    refresh: query.refetch,
    operationError: mutation.error,
    remove: (category: Category) =>
      run({
        categoryId: category.id,
        run: async () => {
          if (client === undefined) throw new Error("Not authenticated");
          await deleteCategory(client, category.id);
        },
      }),
    restore: (category: Category) =>
      run({
        categoryId: category.id,
        run: async () => {
          if (client === undefined) throw new Error("Not authenticated");
          await updateCategory(client, category.id, { archived: false });
        },
      }),
    save: (category: Category, request: CategoryCreateRequest) =>
      run({
        categoryId: category.id,
        run: async () => {
          if (client === undefined) throw new Error("Not authenticated");
          await updateCategory(client, category.id, {
            description: request.description ?? null,
            name: request.name,
            quietByDefault: request.quietByDefault,
          });
        },
      }),
    setArchived: (category: Category) =>
      run({
        categoryId: category.id,
        run: async () => {
          if (client === undefined) throw new Error("Not authenticated");
          await updateCategory(client, category.id, { archived: true });
        },
      }),
    setQuiet: (category: Category, quietByDefault: boolean) =>
      run({
        categoryId: category.id,
        run: async () => {
          if (client === undefined) throw new Error("Not authenticated");
          await updateCategory(client, category.id, { quietByDefault });
        },
      }),
    systemCategories: categories.filter((category) => category.isSystem),
  };
}
