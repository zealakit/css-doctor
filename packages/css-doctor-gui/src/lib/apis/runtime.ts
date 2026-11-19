import type { ReportSessionSource } from "./report";

export type RuntimeInfo = {
  ok: true;
  runtime: "web";
  capabilities: {
    loadReport: boolean;
    uploadReport: boolean;
    reloadReport: boolean;
    generateCheck: boolean;
    discoverReports: boolean;
    selectProject: boolean;
    openExternal: boolean;
    settings: boolean;
    recentReports: boolean;
    desktopSidecar?: boolean;
  };
  phase: number;
  hasReport: boolean;
  source: ReportSessionSource | null;
  note: string;
};

export type HealthInfo = {
  ok: true;
  service: string;
  mode: string;
  version: string;
  now: string;
};

export async function fetchHealth(): Promise<HealthInfo> {
  const response = await fetch("/api/health", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Health request failed (${response.status})`);
  }
  return (await response.json()) as HealthInfo;
}

export async function fetchRuntimeInfo(): Promise<RuntimeInfo> {
  const response = await fetch("/api/runtime", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Runtime request failed (${response.status})`);
  }
  return (await response.json()) as RuntimeInfo;
}
