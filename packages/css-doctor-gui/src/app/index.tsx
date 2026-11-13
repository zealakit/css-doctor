import { ReportProvider } from "@/hooks/use-report";
import { SettingsProvider } from "@/hooks/use-settings";

import { AppRouter } from "./router";

export function App() {
  return (
    <SettingsProvider>
      <ReportProvider>
        <AppRouter />
      </ReportProvider>
    </SettingsProvider>
  );
}
