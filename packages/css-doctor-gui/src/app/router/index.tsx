import { Suspense } from "react";
import {
  Navigate,
  RouterProvider,
  createBrowserRouter,
} from "react-router-dom";

import { ConsoleLayout } from "@/components/layouts/console-layout";
import { LoadingState } from "@/components/ui";
import { ROUTES } from "@/lib/constants";

import { overviewRoute } from "./overview";
import { diagnosticsRoute } from "./diagnostics";
import { analysisRoute } from "./analysis";
import { optimizationRoute } from "./optimization";
import { splittingRoute } from "./splitting";
import { regressionRoute } from "./regression";
import { filesRoute } from "./files";
import { settingsRoute } from "./settings";

const router = createBrowserRouter([
  {
    path: "/",
    element: <ConsoleLayout />,
    children: [
      overviewRoute,
      diagnosticsRoute,
      analysisRoute,
      optimizationRoute,
      splittingRoute,
      regressionRoute,
      filesRoute,
      settingsRoute,
      {
        path: "*",
        element: <Navigate to={ROUTES.OVERVIEW} replace />,
      },
    ],
  },
]);

export function AppRouter() {
  return (
    <Suspense fallback={<LoadingState label="Loading screen…" />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}
