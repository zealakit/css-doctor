import { lazy } from "react";
import type { RouteObject } from "react-router-dom";

const OverviewRoute = lazy(async () => {
  const module = await import("@/app/features/overview/overview.route");
  return { default: module.OverviewRoute };
});

export const overviewRoute: RouteObject = {
  index: true,
  element: <OverviewRoute />,
};
