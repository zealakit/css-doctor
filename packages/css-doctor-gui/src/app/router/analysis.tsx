import { lazy } from "react";
import type { RouteObject } from "react-router-dom";

import { ROUTES } from "@/lib/constants";

const AnalysisRoute = lazy(async () => {
  const module = await import("@/app/features/analysis/analysis.route");
  return { default: module.AnalysisRoute };
});

export const analysisRoute: RouteObject = {
  path: ROUTES.ANALYSIS.slice(1),
  element: <AnalysisRoute />,
};
