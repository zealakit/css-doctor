import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { describeError } from "./file";

export const DEFAULT_BASELINE_PATH = ".css-doctor/baseline.json";
export const DEFAULT_CONFIG_PATH = ".css-doctor/config.json";

export type CssDoctorRegressionConfig = {
  enabled: boolean;
  scoreTolerance: number;
  sizeIncreasePercent: number;
  sizeAbsoluteToleranceBytes: number;
  maxNewErrors: number | null;
  maxNewWarnings: number | null;
};

export type CssDoctorQualityGatesConfig = {
  minScore: number | null;
  maxCssSize: number | null;
  maxSizeIncreasePercent: number | null;
  maxNewErrors: number | null;
  maxNewWarnings: number | null;
  failOnRegression: boolean;
  failOnNewErrors: boolean;
  failOnNewDiagnostics: boolean;
};

export type CssDoctorConfig = {
  baseline: string;
  patterns: string[];
  threshold: number | null;
  regression: CssDoctorRegressionConfig;
  qualityGates: CssDoctorQualityGatesConfig;
};

export type LoadedConfig = {
  config: CssDoctorConfig;
  path: string | null;
  errors: string[];
};

const DEFAULT_CONFIG: CssDoctorConfig = {
  baseline: DEFAULT_BASELINE_PATH,
  patterns: [],
  threshold: null,
  regression: {
    enabled: true,
    scoreTolerance: 1,
    sizeIncreasePercent: 10,
    sizeAbsoluteToleranceBytes: 1024,
    maxNewErrors: null,
    maxNewWarnings: null,
  },
  qualityGates: {
    minScore: null,
    maxCssSize: null,
    maxSizeIncreasePercent: null,
    maxNewErrors: null,
    maxNewWarnings: null,
    failOnRegression: false,
    failOnNewErrors: false,
    failOnNewDiagnostics: false,
  },
};

/**
 * Loads `.css-doctor/config.json` when present.
 *
 * Precedence for consumers: CLI flags > config file > built-in defaults.
 */
export async function loadProjectConfig(
  cwd: string,
  configPath?: string,
): Promise<LoadedConfig> {
  const absoluteConfigPath = resolve(cwd, configPath ?? DEFAULT_CONFIG_PATH);
  const errors: string[] = [];

  try {
    const raw = await readFile(absoluteConfigPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const config = normalizeConfig(parsed, errors);
    return {
      config,
      path: absoluteConfigPath,
      errors,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        config: structuredClone(DEFAULT_CONFIG),
        path: null,
        errors: [],
      };
    }

    return {
      config: structuredClone(DEFAULT_CONFIG),
      path: absoluteConfigPath,
      errors: [
        `Failed to load config ${absoluteConfigPath}: ${describeError(error)}`,
      ],
    };
  }
}

/** Resolves a baseline path relative to cwd unless already absolute. */
export function resolveBaselinePath(cwd: string, baselinePath: string): string {
  return isAbsolute(baselinePath) ? baselinePath : resolve(cwd, baselinePath);
}

export function defaultConfig(): CssDoctorConfig {
  return structuredClone(DEFAULT_CONFIG);
}

function normalizeConfig(value: unknown, errors: string[]): CssDoctorConfig {
  const config = structuredClone(DEFAULT_CONFIG);

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors.push("Config root must be a JSON object.");
    return config;
  }

  const root = value as Record<string, unknown>;

  if (root.baseline !== undefined) {
    if (typeof root.baseline !== "string" || root.baseline.trim() === "") {
      errors.push("`baseline` must be a non-empty string path.");
    } else {
      config.baseline = root.baseline;
    }
  }

  if (root.patterns !== undefined) {
    if (
      !Array.isArray(root.patterns) ||
      root.patterns.some((pattern) => typeof pattern !== "string")
    ) {
      errors.push("`patterns` must be an array of strings.");
    } else {
      config.patterns = root.patterns as string[];
    }
  }

  if (root.threshold !== undefined) {
    if (
      typeof root.threshold !== "number" ||
      !Number.isInteger(root.threshold) ||
      root.threshold < 0
    ) {
      errors.push("`threshold` must be a non-negative integer.");
    } else {
      config.threshold = root.threshold;
    }
  }

  if (root.regression !== undefined) {
    Object.assign(
      config.regression,
      normalizeRegression(root.regression, errors),
    );
  }

  if (root.qualityGates !== undefined) {
    Object.assign(
      config.qualityGates,
      normalizeQualityGates(root.qualityGates, errors),
    );
  }

  return config;
}

function normalizeRegression(
  value: unknown,
  errors: string[],
): Partial<CssDoctorRegressionConfig> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors.push("`regression` must be an object.");
    return {};
  }

  const source = value as Record<string, unknown>;
  const result: Partial<CssDoctorRegressionConfig> = {};

  if (source.enabled !== undefined) {
    if (typeof source.enabled !== "boolean") {
      errors.push("`regression.enabled` must be a boolean.");
    } else {
      result.enabled = source.enabled;
    }
  }

  assignNumber(
    source,
    "scoreTolerance",
    result,
    "scoreTolerance",
    errors,
    "`regression.scoreTolerance`",
    { integer: true, min: 0, max: 100 },
  );
  assignNumber(
    source,
    "sizeIncreasePercent",
    result,
    "sizeIncreasePercent",
    errors,
    "`regression.sizeIncreasePercent`",
    { min: 0 },
  );
  assignNumber(
    source,
    "sizeAbsoluteToleranceBytes",
    result,
    "sizeAbsoluteToleranceBytes",
    errors,
    "`regression.sizeAbsoluteToleranceBytes`",
    { integer: true, min: 0 },
  );
  assignNullableInteger(
    source,
    "maxNewErrors",
    result,
    "maxNewErrors",
    errors,
    "`regression.maxNewErrors`",
  );
  assignNullableInteger(
    source,
    "maxNewWarnings",
    result,
    "maxNewWarnings",
    errors,
    "`regression.maxNewWarnings`",
  );

  return result;
}

function normalizeQualityGates(
  value: unknown,
  errors: string[],
): Partial<CssDoctorQualityGatesConfig> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors.push("`qualityGates` must be an object.");
    return {};
  }

  const source = value as Record<string, unknown>;
  const result: Partial<CssDoctorQualityGatesConfig> = {};

  assignNullableInteger(
    source,
    "minScore",
    result,
    "minScore",
    errors,
    "`qualityGates.minScore`",
    { max: 100 },
  );
  assignNullableInteger(
    source,
    "maxCssSize",
    result,
    "maxCssSize",
    errors,
    "`qualityGates.maxCssSize`",
  );
  assignNumber(
    source,
    "maxSizeIncreasePercent",
    result,
    "maxSizeIncreasePercent",
    errors,
    "`qualityGates.maxSizeIncreasePercent`",
    { min: 0, nullable: true },
  );
  assignNullableInteger(
    source,
    "maxNewErrors",
    result,
    "maxNewErrors",
    errors,
    "`qualityGates.maxNewErrors`",
  );
  assignNullableInteger(
    source,
    "maxNewWarnings",
    result,
    "maxNewWarnings",
    errors,
    "`qualityGates.maxNewWarnings`",
  );

  for (const key of [
    "failOnRegression",
    "failOnNewErrors",
    "failOnNewDiagnostics",
  ] as const) {
    if (source[key] !== undefined) {
      if (typeof source[key] !== "boolean") {
        errors.push(`\`qualityGates.${key}\` must be a boolean.`);
      } else {
        result[key] = source[key] as boolean;
      }
    }
  }

  return result;
}

function assignNumber(
  source: Record<string, unknown>,
  sourceKey: string,
  target: Record<string, unknown>,
  targetKey: string,
  errors: string[],
  label: string,
  options: {
    integer?: boolean;
    min?: number;
    max?: number;
    nullable?: boolean;
  } = {},
): void {
  if (source[sourceKey] === undefined) {
    return;
  }

  if (options.nullable && source[sourceKey] === null) {
    target[targetKey] = null;
    return;
  }

  const value = source[sourceKey];
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push(`${label} must be a number.`);
    return;
  }
  if (options.integer && !Number.isInteger(value)) {
    errors.push(`${label} must be an integer.`);
    return;
  }
  if (options.min !== undefined && value < options.min) {
    errors.push(`${label} must be >= ${options.min}.`);
    return;
  }
  if (options.max !== undefined && value > options.max) {
    errors.push(`${label} must be <= ${options.max}.`);
    return;
  }
  target[targetKey] = value;
}

function assignNullableInteger(
  source: Record<string, unknown>,
  sourceKey: string,
  target: Record<string, unknown>,
  targetKey: string,
  errors: string[],
  label: string,
  options: { max?: number } = {},
): void {
  if (source[sourceKey] === undefined) {
    return;
  }
  if (source[sourceKey] === null) {
    target[targetKey] = null;
    return;
  }
  const value = source[sourceKey];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    errors.push(`${label} must be a non-negative integer or null.`);
    return;
  }
  if (options.max !== undefined && value > options.max) {
    errors.push(`${label} must be <= ${options.max}.`);
    return;
  }
  target[targetKey] = value;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
