import { createRequire } from "node:module";

import { describeError } from "./file";

export type BindingModule = typeof import("@zealakit/css-doctor-binding");

const require = createRequire(import.meta.url);
let cachedBinding: BindingModule | undefined;

/** Lazily loads the native binding with a clear rebuild hint on failure. */
export function loadBinding(): BindingModule {
  if (cachedBinding) {
    return cachedBinding;
  }

  try {
    cachedBinding = require("@zealakit/css-doctor-binding") as BindingModule;
    return cachedBinding;
  } catch (error) {
    throw new Error(
      "Unable to load @zealakit/css-doctor-binding. Build it first with " +
        "`pnpm --filter @zealakit/css-doctor-binding build`.\n" +
        describeError(error),
    );
  }
}
