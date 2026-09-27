import { useCallback, useState } from "react";

export type ApiKeyDialogOrigin = "first-launch" | "settings";

export type AppDialog =
  | { kind: "settings"; routeId?: string }
  | { kind: "api-key"; origin: ApiKeyDialogOrigin }
  | { kind: "history"; recordId?: string }
  | null;

export function useAppDialogs() {
  const [dialog, setDialog] = useState<AppDialog>(null);

  const openSettings = useCallback((routeId?: string) => {
    setDialog({ kind: "settings", routeId });
  }, []);

  const openApiKeySetup = useCallback((origin: ApiKeyDialogOrigin) => {
    setDialog({ kind: "api-key", origin });
  }, []);

  const openHistory = useCallback((recordId?: string) => {
    setDialog({ kind: "history", recordId });
  }, []);

  const closeDialog = useCallback(() => {
    setDialog(null);
  }, []);

  return {
    dialog,
    closeDialog,
    openApiKeySetup,
    openHistory,
    openSettings,
  };
}
