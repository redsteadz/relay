"use client";

import { useEffect, useState } from "react";

import styles from "./CopyButton.module.css";

export type CopyButtonProps = {
  text: string;
  label: string;
  copiedLabel: string;
  failedLabel: string;
};

type CopyState = "idle" | "copied" | "failed";

export function CopyButton({ text, label, copiedLabel, failedLabel }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);

  function handleClick() {
    if (typeof navigator.clipboard?.writeText !== "function") {
      setState("failed");
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  }

  const current = state === "copied" ? copiedLabel : state === "failed" ? failedLabel : label;

  return (
    <button
      type="button"
      className={styles.root}
      onClick={handleClick}
      aria-live="polite"
      data-state={state}
    >
      {current}
    </button>
  );
}
