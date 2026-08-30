export type SelectionDraftState = {
  draft: string[];
  saved: string[];
};

export type SelectionDraftAction =
  | { type: "add"; value: string }
  | { type: "cancel" }
  | { type: "confirm"; values?: string[] }
  | { type: "remove"; value: string }
  | { type: "replaceSaved"; values: string[] }
  | { type: "toggle"; value: string };

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function createSelectionDraft(values: readonly string[]): SelectionDraftState {
  const saved = unique(values);
  return { draft: saved, saved };
}

export function selectionDraftReducer(
  state: SelectionDraftState,
  action: SelectionDraftAction,
): SelectionDraftState {
  switch (action.type) {
    case "add":
      return state.draft.includes(action.value)
        ? state
        : { ...state, draft: [...state.draft, action.value] };
    case "cancel":
      return { ...state, draft: state.saved };
    case "confirm": {
      const saved = unique(action.values ?? state.draft);
      return { draft: saved, saved };
    }
    case "remove":
      return { ...state, draft: state.draft.filter((value) => value !== action.value) };
    case "replaceSaved": {
      const saved = unique(action.values);
      return state.draft === state.saved ? { draft: saved, saved } : state;
    }
    case "toggle":
      return state.draft.includes(action.value)
        ? selectionDraftReducer(state, { type: "remove", value: action.value })
        : selectionDraftReducer(state, { type: "add", value: action.value });
  }
}

export function selectionChanged(state: SelectionDraftState): boolean {
  return (
    state.draft.length !== state.saved.length ||
    state.draft.some((value, index) => value !== state.saved[index])
  );
}
