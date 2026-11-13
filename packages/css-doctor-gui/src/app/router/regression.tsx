import { lazy } from "react";
import type { RouteObject } from "react-router-dom";

import { ROUTES } from "@/lib/constants";

const RegressionRoute = lazy(async () => {
  const module = await import("@/app/features/regression/regression.route");
  return { default: module.RegressionRoute };
});

export const regressionRoute: RouteObject = {
  path: ROUTES.REGRESSION.slice(1),
  element: <RegressionRoute />,
};
