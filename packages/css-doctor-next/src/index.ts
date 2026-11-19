import type { NextConfig } from "next";

import { findCssDoctorConfig, loadCssDoctorConfig } from "./config";
import type {
  CssAssetDiagnostic,
  CssAssetSplitInfo,
  CssAssetWarning,
  CssAssetWarningKind,
  CssDoctorNextDiagnostics,
  CssDoctorNextOptions,
  CssDoctorWebpackPluginOptions,
  EmittedCssChunk,
  EmittedPageChunk,
  PageCoverageOptions,
  SizeBudgetDiagnostics,
  SizeBudgetOptions,
} from "./types";
import { CssDoctorWebpackPlugin } from "./webpack-plugin";

type WebpackContextLike = {
  dev?: boolean;
  isServer?: boolean;
};

type WebpackConfigLike = {
  plugins?: unknown[];
  [key: string]: unknown;
};

/**
 * Wraps a Next.js config and adds the css-doctor webpack plugin to the client
 * production compilation.
 *
 * The user's existing `webpack` callback is preserved and may return either a
 * config object or a promise. No plugin is added for dev or server builds.
 */
export function withCssDoctor(
  nextConfig: NextConfig = {},
  options: CssDoctorNextOptions = {},
): NextConfig {
  const pluginOptions = resolvePluginOptions(options);
  const originalWebpack = nextConfig.webpack;

  if (isTurbopackConfig(nextConfig) || process.env.TURBOPACK === "1") {
    console.warn(
      "[css-doctor:next] Turbopack is not supported yet; css-doctor only hooks the webpack client production build. Use `next build` without `--turbopack`, or set `webpack` builds for production CSS splitting.",
    );
  }

  const webpack: NonNullable<NextConfig["webpack"]> = (config, context) => {
    const result = originalWebpack ? originalWebpack(config, context) : config;

    if (isPromiseLike(result)) {
      return result.then((resolvedConfig: unknown) =>
        enableCssDoctor(resolvedConfig, context, pluginOptions),
      );
    }

    return enableCssDoctor(result, context, pluginOptions);
  };

  return {
    ...nextConfig,
    webpack,
  };
}

function isTurbopackConfig(nextConfig: NextConfig): boolean {
  const record = nextConfig as NextConfig & {
    turbopack?: unknown;
    experimental?: { turbo?: unknown; turbopack?: unknown };
  };

  return (
    record.turbopack !== undefined ||
    record.experimental?.turbo !== undefined ||
    record.experimental?.turbopack !== undefined
  );
}

function enableCssDoctor(
  config: unknown,
  context: WebpackContextLike,
  options: CssDoctorWebpackPluginOptions,
): unknown {
  if (!isRecord(config)) {
    return config;
  }

  if (context.dev === true || context.isServer === true) {
    return config;
  }

  const webpackConfig = config as WebpackConfigLike;
  const plugins = Array.isArray(webpackConfig.plugins)
    ? [...webpackConfig.plugins]
    : [];

  const alreadyInstalled = plugins.some(
    (plugin) => plugin instanceof CssDoctorWebpackPlugin,
  );

  if (!alreadyInstalled) {
    plugins.push(new CssDoctorWebpackPlugin(options));
  }

  webpackConfig.plugins = plugins;

  if (options.minify === false) {
    disableNextCssMinifier(webpackConfig);
  }

  return webpackConfig;
}

function disableNextCssMinifier(config: WebpackConfigLike): void {
  const optimization = config.optimization as
    | { minimizer?: unknown[] }
    | undefined;

  if (!optimization || !Array.isArray(optimization.minimizer)) {
    return;
  }

  optimization.minimizer = optimization.minimizer.filter((plugin) => {
    const source =
      typeof plugin === "function"
        ? Function.prototype.toString.call(plugin)
        : String(plugin);

    return (
      !source.includes("CssMinimizerPlugin") &&
      !source.includes("css-minimizer-plugin")
    );
  });
}

function resolvePluginOptions(
  options: CssDoctorNextOptions,
): CssDoctorWebpackPluginOptions {
  const { configFile, ...inlineOptions } = options;
  const hasInlineOptions = Object.keys(inlineOptions).length > 0;

  let loadedOptions: CssDoctorNextOptions = {};
  let configError: string | undefined;

  if (configFile) {
    const loaded = loadCssDoctorConfig({ configFile });
    loadedOptions = loaded.options;
    configError = loaded.error;
  } else if (!hasInlineOptions) {
    const loaded = loadCssDoctorConfig();
    loadedOptions = loaded.options;
    configError = loaded.error;
  }

  if (configError) {
    console.warn(
      `[css-doctor] ${configError}. Continuing with inline/default options.`,
    );
  }

  const merged: CssDoctorNextOptions = {
    ...loadedOptions,
    ...inlineOptions,
  };
  const { configFile: _ignored, ...pluginOptions } = merged;

  return pluginOptions;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { findCssDoctorConfig, loadCssDoctorConfig };
export type {
  CssAssetDiagnostic,
  CssAssetSplitInfo,
  CssAssetWarning,
  CssAssetWarningKind,
  CssDoctorNextDiagnostics,
  CssDoctorNextOptions,
  CssDoctorWebpackPluginOptions,
  EmittedCssChunk,
  EmittedPageChunk,
  PageCoverageOptions,
  SizeBudgetDiagnostics,
  SizeBudgetOptions,
};
