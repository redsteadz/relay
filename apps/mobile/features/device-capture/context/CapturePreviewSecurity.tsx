import { usePathname } from "expo-router";
import { createContext, type PropsWithChildren, useContext } from "react";

import { useDeviceCaptureMode } from "../hooks/useDeviceCaptureCapabilities";
import { useSecureLocalCaptureScreen } from "../hooks/useLocalCapturePreviews";

type CapturePreviewSecurity = {
  error: string | undefined;
  ready: boolean;
};

const CapturePreviewSecurityContext = createContext<CapturePreviewSecurity>({
  error: undefined,
  ready: false,
});

export function CapturePreviewSecurityProvider({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const mode = useDeviceCaptureMode();
  const queueVisible = pathname.includes("/queue");
  const security = useSecureLocalCaptureScreen(mode.developmentLocal && queueVisible);

  return (
    <CapturePreviewSecurityContext.Provider value={security}>
      {children}
    </CapturePreviewSecurityContext.Provider>
  );
}

export function useCapturePreviewSecurity() {
  return useContext(CapturePreviewSecurityContext);
}
