import { useEffect, useReducer, useRef } from "react";

import {
  createSelectionDraft,
  selectionChanged,
  selectionDraftReducer,
} from "../models/selectionDraft";

export function useTransactionalSelection(savedValues: readonly string[]) {
  const [state, dispatch] = useReducer(selectionDraftReducer, savedValues, createSelectionDraft);
  const savedValuesRef = useRef(savedValues);
  savedValuesRef.current = savedValues;
  const savedKey = JSON.stringify(savedValues);

  useEffect(() => {
    dispatch({ type: "replaceSaved", values: [...savedValuesRef.current] });
  }, [savedKey]);

  return {
    add: (value: string) => dispatch({ type: "add", value }),
    cancel: () => dispatch({ type: "cancel" }),
    changed: selectionChanged(state),
    confirm: (values?: readonly string[]) =>
      dispatch(
        values === undefined ? { type: "confirm" } : { type: "confirm", values: [...values] },
      ),
    draft: state.draft,
    remove: (value: string) => dispatch({ type: "remove", value }),
    toggle: (value: string) => dispatch({ type: "toggle", value }),
  };
}
