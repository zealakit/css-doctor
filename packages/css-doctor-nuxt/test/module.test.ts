import assert from "node:assert/strict";
import test from "node:test";

import cssDoctorNuxtModule from "../src/index";

type ViteExtendArgs = {
  config: { plugins?: unknown[] };
  env: { isClient: boolean; isServer: boolean };
};

type ModuleCallable = {
  (
    inlineOptions?: Record<string, unknown>,
    nuxt?: unknown,
  ): void | Promise<void>;
  getOptions?: (
    inlineOptions?: Record<string, unknown>,
  ) => Promise<{ sizeBudget?: { maxChunkSize?: number } }> | {
    sizeBudget?: { maxChunkSize?: number };
  };
};

function createNuxtHarness(dev: boolean) {
  const hooks = new Map<string, Array<(...args: unknown[]) => void>>();
  const nuxt = {
    options: { dev },
    hook(name: string, callback: (...args: unknown[]) => void) {
      const list = hooks.get(name) ?? [];
      list.push(callback);
      hooks.set(name, list);
    },
  };

  return {
    nuxt,
    async callViteExtend(args: ViteExtendArgs) {
      const callbacks = hooks.get("vite:extendConfig") ?? [];
      for (const callback of callbacks) {
        await callback(args.config, args.env);
      }
    },
  };
}

test("module defaults use 30KiB maxChunkSize", async () => {
  const module = cssDoctorNuxtModule as ModuleCallable;
  assert.equal(typeof module.getOptions, "function");
  const options = await module.getOptions?.({});
  assert.equal(options?.sizeBudget?.maxChunkSize, 30 * 1024);
});

test("skips Vite plugin registration in Nuxt dev mode", async () => {
  const harness = createNuxtHarness(true);
  await (cssDoctorNuxtModule as ModuleCallable)({}, harness.nuxt);
  const config = { plugins: [] as unknown[] };
  await harness.callViteExtend({
    config,
    env: { isClient: true, isServer: false },
  });
  assert.equal(config.plugins.length, 0);
});

test("registers vite-plugin-css-doctor on production client builds", async () => {
  const harness = createNuxtHarness(false);
  await (cssDoctorNuxtModule as ModuleCallable)(
    {
      skipVueScopedStyles: false,
      wrapCommonImports: false,
      sizeBudget: { maxChunkSize: 12 * 1024 },
    },
    harness.nuxt,
  );

  const config = { plugins: [] as unknown[] };
  await harness.callViteExtend({
    config,
    env: { isClient: true, isServer: false },
  });

  assert.equal(config.plugins.length, 1);
  const plugin = config.plugins[0] as { name?: string };
  assert.equal(plugin.name, "vite-plugin-css-doctor");
});

test("does not install the plugin for Nitro/SSR vite configs", async () => {
  const harness = createNuxtHarness(false);
  await (cssDoctorNuxtModule as ModuleCallable)({}, harness.nuxt);
  const config = { plugins: [] as unknown[] };
  await harness.callViteExtend({
    config,
    env: { isClient: false, isServer: true },
  });
  assert.equal(config.plugins.length, 0);
});

test("does not duplicate the vite plugin when already present", async () => {
  const harness = createNuxtHarness(false);
  await (cssDoctorNuxtModule as ModuleCallable)({}, harness.nuxt);
  const config = {
    plugins: [{ name: "vite-plugin-css-doctor" }] as unknown[],
  };
  await harness.callViteExtend({
    config,
    env: { isClient: true, isServer: false },
  });
  assert.equal(config.plugins.length, 1);
});
