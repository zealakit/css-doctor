export const ROUTES = {
  OVERVIEW: "/",
  DIAGNOSTICS: "/diagnostics",
  ANALYSIS: "/analysis",
  OPTIMIZATION: "/optimization",
  SPLITTING: "/splitting",
  REGRESSION: "/regression",
  FILES: "/files",
  SETTINGS: "/settings",
} as const;

export type AppRoutePath = (typeof ROUTES)[keyof typeof ROUTES];

export type NavItem = {
  id: string;
  label: string;
  path: AppRoutePath;
  description: string;
};

export const NAV_ITEMS: NavItem[] = [
  {
    id: "overview",
    label: "Overview",
    path: ROUTES.OVERVIEW,
    description: "Project health summary",
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    path: ROUTES.DIAGNOSTICS,
    description: "Warnings and findings",
  },
  {
    id: "analysis",
    label: "CSS Analysis",
    path: ROUTES.ANALYSIS,
    description: "Selectors and usage",
  },
  {
    id: "optimization",
    label: "Optimization",
    path: ROUTES.OPTIMIZATION,
    description: "Savings and operations",
  },
  {
    id: "splitting",
    label: "Splitting",
    path: ROUTES.SPLITTING,
    description: "Common vs page chunks",
  },
  {
    id: "regression",
    label: "Regression",
    path: ROUTES.REGRESSION,
    description: "Baseline comparison",
  },
  {
    id: "files",
    label: "Files",
    path: ROUTES.FILES,
    description: "Per-file insights",
  },
  {
    id: "settings",
    label: "Settings",
    path: ROUTES.SETTINGS,
    description: "Runtime preferences",
  },
];
