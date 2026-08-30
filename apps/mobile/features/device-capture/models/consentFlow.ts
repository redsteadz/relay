export type ConsentState = { checked: boolean };
export type ConsentAction = { type: "reset" } | { checked: boolean; type: "set" };

export const initialConsentState: ConsentState = { checked: false };

export function consentReducer(state: ConsentState, action: ConsentAction): ConsentState {
  if (action.type === "reset") return initialConsentState;
  if (state.checked === action.checked) return state;
  return { checked: action.checked };
}

export function consentSubmitEnabled(state: ConsentState, blocked: boolean): boolean {
  return state.checked && !blocked;
}
