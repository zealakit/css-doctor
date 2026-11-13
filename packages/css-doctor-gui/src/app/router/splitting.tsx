import { lazy } from "react";
import type { RouteObject } from "react-router-dom";

import { ROUTES } from "@/lib/constants";

const SplittingRoute = lazy(async () => {
  const module = await import("@/app/features/splitting/splitting.route");
  return { default: module.SplittingRoute };
});

export const splittingRoute: RouteObject = {
  path: ROUTES.SPLITTING.slice(1),
  element: <SplittingRoute />,
};
