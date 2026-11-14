import { ToastHost } from "@/components/ui";
import { ReportProvider } from "@/hooks/use-report";
import { SettingsProvider } from "@/hooks/use-settings";

import { DashboardPage } from "./dashboard/dashboard-page";

export function App() {
  return (
    <SettingsProvider>
      <ReportProvider>
        <DashboardPage />
        <ToastHost />
      </ReportProvider>
    </SettingsProvider>
  );
}
