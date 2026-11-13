import { lazy } from "react";
import type { RouteObject } from "react-router-dom";

import { ROUTES } from "@/lib/constants";

const OptimizationRoute = lazy(async () => {
  const module = await import("@/app/features/optimization/optimization.route");
  return { default: module.OptimizationRoute };
});

export const optimizationRoute: RouteObject = {
  path: ROUTES.OPTIMIZATION.slice(1),
  element: <OptimizationRoute />,
};
