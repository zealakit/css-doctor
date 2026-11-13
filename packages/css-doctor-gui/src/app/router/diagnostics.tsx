import { lazy } from "react";
import type { RouteObject } from "react-router-dom";

import { ROUTES } from "@/lib/constants";

const DiagnosticsRoute = lazy(async () => {
  const module = await import("@/app/features/diagnostics/diagnostics.route");
  return { default: module.DiagnosticsRoute };
});

export const diagnosticsRoute: RouteObject = {
  path: ROUTES.DIAGNOSTICS.slice(1),
  element: <DiagnosticsRoute />,
};
