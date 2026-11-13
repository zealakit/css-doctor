import { lazy } from "react";
import type { RouteObject } from "react-router-dom";

import { ROUTES } from "@/lib/constants";

const SettingsRoute = lazy(async () => {
  const module = await import("@/app/features/settings/settings.route");
  return { default: module.SettingsRoute };
});

export const settingsRoute: RouteObject = {
  path: ROUTES.SETTINGS.slice(1),
  element: <SettingsRoute />,
};
