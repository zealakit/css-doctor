import assert from "node:assert/strict";
import test from "node:test";

import cssDoctorNuxtModule from "../dist/index.js";

function createNuxtHarness(dev) {
  const hooks = new Map();
  const nuxt = {
    // Minimal Nuxt instance surface for defineNuxtModule install checks.
    _version: "4.6.4",
    options: {
      dev,
      builder: "@nuxt/vite-builder",
      rootDir: process.cwd(),
      workspaceDir: process.cwd(),
      experimental: {},
      _requiredModules: {},
    },
    async callHook() {},
    hook(name, callback) {
      const list = hooks.get(name) ?? [];
      list.push(callback);
      hooks.set(name, list);
    },
  };

  return {
    nuxt,
    async callViteExtend(args) {
      const callbacks = hooks.get("vite:extendConfig") ?? [];
      for (const callback of callbacks) {
        await callback(args.config, args.env);
      }
    },
  };
}

test("module defaults use 30KiB maxChunkSize", async () => {
  assert.equal(typeof cssDoctorNuxtModule.getOptions, "function");
  const harness = createNuxtHarness(false);
  const options = await cssDoctorNuxtModule.getOptions({}, harness.nuxt);
  assert.equal(options?.sizeBudget?.maxChunkSize, 30 * 1024);
});

test("skips Vite plugin registration in Nuxt dev mode", async () => {
  const harness = createNuxtHarness(true);
  await cssDoctorNuxtModule({}, harness.nuxt);
  const config = { plugins: [] };
  await harness.callViteExtend({
    config,
    env: { isClient: true, isServer: false },
  });
  assert.equal(config.plugins.length, 0);
});

test("registers vite-plugin-css-doctor on production client builds", async () => {
  const harness = createNuxtHarness(false);
  await cssDoctorNuxtModule(
    {
      skipVueScopedStyles: false,
      wrapCommonImports: false,
      sizeBudget: { maxChunkSize: 12 * 1024 },
    },
    harness.nuxt,
  );

  const config = { plugins: [] };
  await harness.callViteExtend({
    config,
    env: { isClient: true, isServer: false },
  });

  assert.equal(config.plugins.length, 1);
  assert.equal(config.plugins[0]?.name, "vite-plugin-css-doctor");
});

test("does not install the plugin for Nitro/SSR vite configs", async () => {
  const harness = createNuxtHarness(false);
  await cssDoctorNuxtModule({}, harness.nuxt);
  const config = { plugins: [] };
  await harness.callViteExtend({
    config,
    env: { isClient: false, isServer: true },
  });
  assert.equal(config.plugins.length, 0);
});

test("does not duplicate the vite plugin when already present", async () => {
  const harness = createNuxtHarness(false);
  await cssDoctorNuxtModule({}, harness.nuxt);
  const config = {
    plugins: [{ name: "vite-plugin-css-doctor" }],
  };
  await harness.callViteExtend({
    config,
    env: { isClient: true, isServer: false },
  });
  assert.equal(config.plugins.length, 1);
});
