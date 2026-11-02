import { defineNuxtModule } from "@nuxt/kit";
import { cssDoctor } from "@zealakit/css-doctor-vite";
import type { NuxtModule } from "@nuxt/schema";

import type { ModuleOptions } from "./types";

const VITE_PLUGIN_NAME = "vite-plugin-css-doctor";

const cssDoctorNuxtModule: NuxtModule<ModuleOptions> =
  defineNuxtModule<ModuleOptions>({
    meta: {
      name: "@zealakit/css-doctor-nuxt",
      configKey: "cssDoctor",
      compatibility: {
        nuxt: ">=3.0.0",
      },
    },
    defaults: {
      pageCoverage: {
        enabled: true,
        minPageRatio: 0.5,
      },
      sizeBudget: {
        enabled: true,
        maxChunkSize: 30 * 1024,
        isolateVariables: true,
      },
      minify: true,
      report: true,
    },
    setup(options, nuxt) {
      // Never touch Vite's dev server or Nitro's SSR graph. css-doctor's
      // asset-level pipeline is only meaningful for the production client build.
      if (nuxt.options.dev) {
        return;
      }

      nuxt.hook("vite:extendConfig", (config, { isClient, isServer }) => {
        if (!isClient || isServer) {
          return;
        }

        const plugins = [...(config.plugins ?? [])];
        const alreadyInstalled = plugins.some((plugin) => {
          return (
            typeof plugin === "object" &&
            plugin !== null &&
            "name" in plugin &&
            plugin.name === VITE_PLUGIN_NAME
          );
        });

        if (!alreadyInstalled) {
          plugins.push(
            cssDoctor({
              ...options,
              skipVueScopedStyles: true,
              wrapCommonImports: true,
            }),
          );
        }

        (config as typeof config & { plugins?: unknown[] }).plugins = plugins;
      });
    },
  });

export default cssDoctorNuxtModule;

export type * from "./types";
