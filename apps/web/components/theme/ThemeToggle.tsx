"use client";

import { useSyncExternalStore } from "react";

import {
  isThemePreference,
  themeAttribute,
  themePreferences,
  themeStorageKey,
  type ThemePreference,
} from "../../lib/theme";

import styles from "./ThemeToggle.module.css";

export type ThemeToggleProps = {
  label: string;
  options: Record<ThemePreference, string>;
};

const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(themeStorageKey);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function readServerPreference(): ThemePreference {
  return "system";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function writePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") window.localStorage.removeItem(themeStorageKey);
    else window.localStorage.setItem(themeStorageKey, preference);
  } catch {
    // Storage can be unavailable; the attribute below still applies for this page view.
  }
  if (preference === "system") document.documentElement.removeAttribute(themeAttribute);
  else document.documentElement.setAttribute(themeAttribute, preference);
  for (const listener of listeners) listener();
}

export function ThemeToggle({ label, options }: ThemeToggleProps) {
  const preference = useSyncExternalStore(subscribe, readPreference, readServerPreference);

  return (
    <div role="radiogroup" aria-label={label} className={styles.root}>
      {themePreferences.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={preference === option}
          className={styles.option}
          onClick={() => writePreference(option)}
        >
          {options[option]}
        </button>
      ))}
    </div>
  );
}
