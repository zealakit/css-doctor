import type { NextConfig } from "next";

import { withCssDoctor } from "@zealakit/css-doctor-next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withCssDoctor(nextConfig, {
  pageCoverage: {
    enabled: true,
    minPageRatio: 0.5,
  },
  sizeBudget: {
    enabled: true,
    maxChunkSize: 40 * 1024,
    isolateVariables: true,
  },
  minify: true,
  report: true,
});
