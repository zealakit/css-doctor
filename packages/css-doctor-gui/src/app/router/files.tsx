import { lazy } from "react";
import type { RouteObject } from "react-router-dom";

import { ROUTES } from "@/lib/constants";

const FilesRoute = lazy(async () => {
  const module = await import("@/app/features/files/files.route");
  return { default: module.FilesRoute };
});

export const filesRoute: RouteObject = {
  path: ROUTES.FILES.slice(1),
  element: <FilesRoute />,
};
