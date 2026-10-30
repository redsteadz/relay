import { useState } from "react";

import { SetupStep } from "@/features/onboarding/components/SetupStep";
import { WelcomeStep } from "@/features/onboarding/components/WelcomeStep";
import { useOnboarding } from "@/lib/onboarding-context";

/**
 * The introduction: one screen to say what Relay is, then the permissions it needs.
 *
 * Choosing applications is not a step. Naming an application in a rule is what lets Relay read it
 * (ADR-0023), so the first thing a person does after this is write a rule, not curate a list.
 */
export default function OnboardingScreen() {
  const onboarding = useOnboarding();
  const [step, setStep] = useState<"setup" | "welcome">("welcome");

  // Completing flips the route guard in the root layout, which navigates away on its own. Pushing
  // a destination from here as well would race that redirect and could land somewhere the guard
  // does not allow -- sign-in, for a person who has not signed in yet.
  if (step === "welcome") return <WelcomeStep onStart={() => setStep("setup")} />;
  return <SetupStep onFinish={onboarding.complete} />;
}
