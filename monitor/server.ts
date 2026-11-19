/**
 * Local Dependency Monitor for css-doctor (root + packages/* only).
 *
 *   pnpm monitor
 *   → http://127.0.0.1:4177
 */
import { execFile } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HOST = "127.0.0.1";
const PREFERRED_PORT = 4177;
const INDEX_HTML = path.join(__dirname, "index.html");

type DepType =
  | "dependencies"
  | "devDependencies"
  | "peerDependencies"
  | "optionalDependencies";

type ManifestInfo = {
  id: string;
  name: string;
  label: string;
  relativePackageJson: string;
  absolutePackageJson: string;
};

type DeclaredDependency = {
  id: string;
  dependency: string;
  manifestId: string;
  packageName: string;
  depType: DepType;
  declared: string;
  resolved: string | null;
  ecosystem: "node";
  local: boolean;
};

type UpdateClass =
  | "up-to-date"
  | "patch-available"
  | "minor-available"
  | "major-available"
  | "deprecated"
  | "registry-check-failed"
  | "skipped";

type RegistryInfo = {
  latest: string | null;
  latestPatch: string | null;
  latestMinor: string | null;
  latestMajor: string | null;
  versions: string[];
  deprecated: boolean | string | null;
  classification: UpdateClass;
  error?: string;
};

type DependencyRow = DeclaredDependency & {
  registry: RegistryInfo;
};

type UpdateRequest = {
  manifestId: string;
  dependency: string;
  depType: DepType;
  targetVersion: string;
  preserveRange?: boolean;
};

type SemVer = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  raw: string;
};

const DEP_TYPES: DepType[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const registryCache = new Map<
  string,
  { ok: true; info: RegistryInfo } | { ok: false; error: string }
>();

let lastRegistryCheckAt: string | null = null;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(
  res: ServerResponse,
  status: number,
  body: string,
  contentType: string,
): void {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

function isLocalHost(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? "").split(":")[0]?.toLowerCase();
  return host === "127.0.0.1" || host === "localhost";
}

function discoverManifests(): ManifestInfo[] {
  const manifests: ManifestInfo[] = [];
  const rootPkg = path.join(ROOT, "package.json");
  if (fs.existsSync(rootPkg)) {
    const json = JSON.parse(fs.readFileSync(rootPkg, "utf8")) as {
      name?: string;
    };
    manifests.push({
      id: ".",
      name: json.name ?? "css-doctor",
      label: "Root",
      relativePackageJson: "package.json",
      absolutePackageJson: rootPkg,
    });
  }

  const packagesDir = path.join(ROOT, "packages");
  if (!fs.existsSync(packagesDir)) return manifests;

  for (const dirName of fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    if (dirName === "examples") continue;
    const absolutePackageJson = path.join(packagesDir, dirName, "package.json");
    if (!fs.existsSync(absolutePackageJson)) continue;
    const json = JSON.parse(fs.readFileSync(absolutePackageJson, "utf8")) as {
      name?: string;
    };
    manifests.push({
      id: `packages/${dirName}`,
      name: json.name ?? dirName,
      label: json.name ?? dirName,
      relativePackageJson: `packages/${dirName}/package.json`,
      absolutePackageJson,
    });
  }

  return manifests;
}

function assertApprovedManifest(manifestId: string): ManifestInfo {
  const manifests = discoverManifests();
  const match = manifests.find((item) => item.id === manifestId);
  if (!match) {
    throw new Error(`Unknown or disallowed manifest id: ${manifestId}`);
  }
  if (
    match.id.startsWith("examples") ||
    match.relativePackageJson.includes("examples/")
  ) {
    throw new Error("examples/ manifests are excluded");
  }
  return match;
}

function parseSemVer(input: string): SemVer | null {
  const token =
    input
      .trim()
      .match(/v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0]
      ?.replace(/^v/, "") ?? "";
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(token);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
    raw: `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ""}`,
  };
}

function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function maxStable(
  versions: string[],
  predicate?: (v: SemVer) => boolean,
): string | null {
  let best: SemVer | null = null;
  for (const version of versions) {
    const parsed = parseSemVer(version);
    if (!parsed || parsed.prerelease) continue;
    if (predicate && !predicate(parsed)) continue;
    if (!best || compareSemVer(parsed, best) > 0) best = parsed;
  }
  return best?.raw ?? null;
}

function isSkippableSpec(spec: string): boolean {
  return (
    spec.startsWith("workspace:") ||
    spec.startsWith("file:") ||
    spec.startsWith("link:") ||
    spec.startsWith("portal:") ||
    spec.startsWith("catalog:") ||
    spec.includes("://") ||
    spec.startsWith("git+")
  );
}

function preserveRange(current: string, nextExact: string): string {
  if (current.startsWith("^")) return `^${nextExact}`;
  if (current.startsWith("~")) return `~${nextExact}`;
  return nextExact;
}

function classify(
  declared: string,
  info: Omit<RegistryInfo, "classification" | "error">,
): UpdateClass {
  if (info.deprecated) return "deprecated";
  if (!info.latest) return "registry-check-failed";
  const current = parseSemVer(declared);
  const latest = parseSemVer(info.latest);
  if (!current || !latest) return "registry-check-failed";
  if (compareSemVer(latest, current) <= 0) return "up-to-date";
  if (latest.major > current.major) return "major-available";
  if (latest.minor > current.minor) return "minor-available";
  return "patch-available";
}

async function fetchRegistry(
  dependency: string,
  declared: string,
): Promise<RegistryInfo> {
  if (isSkippableSpec(declared)) {
    return {
      latest: null,
      latestPatch: null,
      latestMinor: null,
      latestMajor: null,
      versions: [],
      deprecated: null,
      classification: "skipped",
      error: "Non-registry version specification",
    };
  }

  const cached = registryCache.get(dependency);
  if (cached?.ok) {
    return {
      ...cached.info,
      classification: classify(declared, cached.info),
    };
  }
  if (cached && !cached.ok) {
    return {
      latest: null,
      latestPatch: null,
      latestMinor: null,
      latestMajor: null,
      versions: [],
      deprecated: null,
      classification: "registry-check-failed",
      error: cached.error,
    };
  }

  const encoded = dependency
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

  try {
    const response = await fetch(`https://registry.npmjs.org/${encoded}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      const error = `Registry HTTP ${response.status} for ${dependency}`;
      registryCache.set(dependency, { ok: false, error });
      return {
        latest: null,
        latestPatch: null,
        latestMinor: null,
        latestMajor: null,
        versions: [],
        deprecated: null,
        classification: "registry-check-failed",
        error,
      };
    }

    const doc = (await response.json()) as {
      "dist-tags"?: { latest?: string };
      versions?: Record<string, { deprecated?: string }>;
      deprecated?: string;
    };

    const versions = Object.keys(doc.versions ?? {}).filter((version) => {
      const parsed = parseSemVer(version);
      return Boolean(parsed && !parsed.prerelease);
    });
    const latest = doc["dist-tags"]?.latest ?? maxStable(versions);
    const baseline = parseSemVer(declared);
    const latestPatch = baseline
      ? maxStable(
          versions,
          (v) => v.major === baseline.major && v.minor === baseline.minor,
        )
      : null;
    const latestMinor = baseline
      ? maxStable(versions, (v) => v.major === baseline.major)
      : null;
    const latestMajor = maxStable(versions);
    const deprecated =
      (latest && doc.versions?.[latest]?.deprecated) || doc.deprecated || false;

    const base: Omit<RegistryInfo, "classification" | "error"> = {
      latest: latest ?? null,
      latestPatch,
      latestMinor,
      latestMajor,
      versions: versions.sort((a, b) => {
        const pa = parseSemVer(a);
        const pb = parseSemVer(b);
        if (!pa || !pb) return a.localeCompare(b);
        return compareSemVer(pb, pa);
      }),
      deprecated: deprecated === false ? false : deprecated,
    };

    registryCache.set(dependency, {
      ok: true,
      info: { ...base, classification: "up-to-date" },
    });

    return {
      ...base,
      classification: classify(declared, base),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    registryCache.set(dependency, { ok: false, error: message });
    return {
      latest: null,
      latestPatch: null,
      latestMinor: null,
      latestMajor: null,
      versions: [],
      deprecated: null,
      classification: "registry-check-failed",
      error: message,
    };
  }
}

function readResolvedFromLockfile(): Map<string, string> {
  const lockPath = path.join(ROOT, "pnpm-lock.yaml");
  const resolved = new Map<string, string>();
  if (!fs.existsSync(lockPath)) return resolved;

  const text = fs.readFileSync(lockPath, "utf8");
  const lines = text.split("\n");
  let inImporters = false;
  let currentImporter: string | null = null;
  let inDepBlock = false;

  for (const line of lines) {
    if (line === "importers:") {
      inImporters = true;
      continue;
    }
    if (inImporters && /^\S/.test(line) && line !== "importers:") {
      // pnpm 12 can emit more than one importers/packages pair (the first one
      // only carries configDependencies). Keep scanning the file so the real
      // workspace importers later in the lockfile are not skipped.
      inImporters = false;
      currentImporter = null;
      inDepBlock = false;
      continue;
    }
    if (!inImporters) continue;

    const importerMatch = /^ {2}(\.|packages\/[^:]+):$/.exec(line);
    if (importerMatch) {
      currentImporter = importerMatch[1] ?? null;
      inDepBlock = false;
      continue;
    }

    if (
      currentImporter &&
      /^ {4}(dependencies|devDependencies|peerDependencies|optionalDependencies):$/.test(
        line,
      )
    ) {
      inDepBlock = true;
      continue;
    }

    if (currentImporter && /^ {4}\S/.test(line)) {
      inDepBlock = false;
    }

    if (!currentImporter || !inDepBlock) continue;

    const nameMatch = /^ {6}(.+):$/.exec(line);
    if (nameMatch) {
      const depName = nameMatch[1]?.replace(/^['"]|['"]$/g, "") ?? "";
      // look ahead handled by version line below via temporary key
      resolved.set(`${currentImporter}::pending`, depName);
      continue;
    }

    const versionMatch = /^ {8}version:\s+(.+)$/.exec(line);
    if (versionMatch) {
      const depName = resolved.get(`${currentImporter}::pending`);
      if (depName) {
        let version = versionMatch[1]?.trim() ?? "";
        version = version.replace(/^['"]|['"]$/g, "");
        // pnpm may store "1.2.3(peer@x)" — take the leading semver
        version = version.split("(")[0]?.trim() ?? version;
        resolved.set(`${currentImporter}::${depName}`, version);
        resolved.delete(`${currentImporter}::pending`);
      }
    }
  }

  return resolved;
}

function listDeclarations(): DeclaredDependency[] {
  const manifests = discoverManifests();
  const lockResolved = readResolvedFromLockfile();
  const rows: DeclaredDependency[] = [];

  for (const manifest of manifests) {
    const json = JSON.parse(
      fs.readFileSync(manifest.absolutePackageJson, "utf8"),
    ) as Record<string, Record<string, string> | undefined>;

    for (const depType of DEP_TYPES) {
      const block = json[depType];
      if (!block) continue;
      for (const [dependency, declared] of Object.entries(block)) {
        rows.push({
          id: `${manifest.id}::${depType}::${dependency}`,
          dependency,
          manifestId: manifest.id,
          packageName: manifest.name,
          depType,
          declared,
          resolved: lockResolved.get(`${manifest.id}::${dependency}`) ?? null,
          ecosystem: "node",
          local: isSkippableSpec(declared),
        });
      }
    }
  }

  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

async function buildDependencyRows(options?: {
  refresh?: boolean;
}): Promise<DependencyRow[]> {
  if (options?.refresh) {
    registryCache.clear();
  }
  const declarations = listDeclarations();
  const uniqueNames = [...new Set(declarations.map((item) => item.dependency))];

  // Warm cache once per unique dependency (using first declared sample).
  const sampleDeclared = new Map<string, string>();
  for (const item of declarations) {
    if (!sampleDeclared.has(item.dependency)) {
      sampleDeclared.set(item.dependency, item.declared);
    }
  }
  await Promise.all(
    uniqueNames.map(async (name) => {
      await fetchRegistry(name, sampleDeclared.get(name) ?? "");
    }),
  );

  lastRegistryCheckAt = new Date().toISOString();

  const rows: DependencyRow[] = [];
  for (const item of declarations) {
    rows.push({
      ...item,
      registry: await fetchRegistry(item.dependency, item.declared),
    });
  }
  return rows;
}

function summarize(rows: DependencyRow[]) {
  const unique = new Set(rows.map((row) => row.dependency));
  const byDepClass = new Map<string, UpdateClass>();
  for (const row of rows) {
    const prev = byDepClass.get(row.dependency);
    const rank: Record<UpdateClass, number> = {
      deprecated: 0,
      "major-available": 1,
      "minor-available": 2,
      "patch-available": 3,
      "registry-check-failed": 4,
      skipped: 5,
      "up-to-date": 6,
    };
    if (!prev || rank[row.registry.classification] < rank[prev]) {
      byDepClass.set(row.dependency, row.registry.classification);
    }
  }

  let upToDate = 0;
  let updatesAvailable = 0;
  let deprecated = 0;
  let failed = 0;
  for (const classification of byDepClass.values()) {
    if (classification === "up-to-date" || classification === "skipped") {
      upToDate += 1;
    } else if (classification === "deprecated") {
      deprecated += 1;
      updatesAvailable += 1;
    } else if (classification === "registry-check-failed") {
      failed += 1;
    } else {
      updatesAvailable += 1;
    }
  }

  return {
    total: unique.size,
    outdated: updatesAvailable,
    upToDate,
    errors: failed,
    uniqueDependencies: unique.size,
    declarationCount: rows.length,
    updatesAvailable,
    deprecated,
    registryFailures: failed,
    lastRegistryCheckAt,
    ecosystems: ["node"],
  };
}

function validateUpdateRequest(input: unknown): UpdateRequest {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid update payload");
  }
  const body = input as Record<string, unknown>;
  const manifestId = body.manifestId;
  const dependency = body.dependency;
  const depType = body.depType;
  const targetVersion = body.targetVersion;

  if (typeof manifestId !== "string" || !manifestId) {
    throw new Error("manifestId is required");
  }
  if (typeof dependency !== "string" || !dependency) {
    throw new Error("dependency is required");
  }
  if (!DEP_TYPES.includes(depType as DepType)) {
    throw new Error("depType is invalid");
  }
  if (typeof targetVersion !== "string" || !targetVersion.trim()) {
    throw new Error("targetVersion is required");
  }
  if (
    targetVersion.includes("..") ||
    targetVersion.includes("/") ||
    /\s/.test(targetVersion)
  ) {
    throw new Error("targetVersion looks unsafe");
  }

  assertApprovedManifest(manifestId);

  return {
    manifestId,
    dependency,
    depType: depType as DepType,
    targetVersion: targetVersion.trim().replace(/^[~^]/, ""),
    preserveRange: body.preserveRange !== false,
  };
}

async function applyUpdate(
  request: UpdateRequest,
  options: { dryRun: boolean },
): Promise<{
  dryRun: boolean;
  from: string;
  to: string;
  lockfileSynced: boolean;
}> {
  const manifest = assertApprovedManifest(request.manifestId);
  const original = await fsp.readFile(manifest.absolutePackageJson, "utf8");
  const json = JSON.parse(original) as Record<
    string,
    Record<string, string> | undefined
  >;
  const block = json[request.depType];
  if (!block || !(request.dependency in block)) {
    throw new Error(
      `${request.dependency} not found in ${request.depType} of ${manifest.id}`,
    );
  }

  const from = block[request.dependency] ?? "";
  const exact = request.targetVersion;
  if (!parseSemVer(exact)) {
    throw new Error(`Invalid target version: ${exact}`);
  }
  const to = request.preserveRange ? preserveRange(from, exact) : exact;

  if (options.dryRun) {
    return { dryRun: true, from, to, lockfileSynced: false };
  }

  if (from === to) {
    return { dryRun: false, from, to, lockfileSynced: false };
  }

  block[request.dependency] = to;
  await fsp.writeFile(
    manifest.absolutePackageJson,
    `${JSON.stringify(json, null, 2)}\n`,
    "utf8",
  );

  try {
    // Refresh the lockfile from manifests without running prepare/build hooks.
    await execFileAsync(
      "pnpm",
      ["install", "--lockfile-only", "--ignore-scripts"],
      {
        cwd: ROOT,
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    return { dryRun: false, from, to, lockfileSynced: true };
  } catch (error) {
    await fsp.writeFile(manifest.absolutePackageJson, original, "utf8");
    throw new Error(
      `Package manager update failed; restored ${manifest.relativePackageJson}. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const method = req.method ?? "GET";
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/packages") {
    const packages = discoverManifests().map((item) => ({
      id: item.id,
      name: item.name,
      label: item.label,
      relativePackageJson: item.relativePackageJson,
    }));
    sendJson(res, 200, { packages });
    return;
  }

  if (method === "GET" && pathname === "/api/dependencies") {
    const refresh = url.searchParams.get("refresh") === "1";
    const rows = await buildDependencyRows({ refresh });
    sendJson(res, 200, {
      dependencies: rows,
      summary: summarize(rows),
      lastRegistryCheckAt,
    });
    return;
  }

  if (method === "GET" && pathname === "/api/summary") {
    const rows = await buildDependencyRows();
    sendJson(res, 200, summarize(rows));
    return;
  }

  if (method === "POST" && pathname === "/api/refresh") {
    registryCache.clear();
    const rows = await buildDependencyRows({ refresh: true });
    sendJson(res, 200, {
      dependencies: rows,
      summary: summarize(rows),
      lastRegistryCheckAt,
    });
    return;
  }

  if (method === "GET" && pathname === "/api/versions") {
    const name = url.searchParams.get("name");
    if (!name) {
      sendJson(res, 400, { error: "name query param is required" });
      return;
    }
    const sample =
      listDeclarations().find((item) => item.dependency === name)?.declared ??
      "0.0.0";
    const info = await fetchRegistry(name, sample);
    sendJson(res, 200, { dependency: name, ...info });
    return;
  }

  if (method === "POST" && pathname === "/api/update") {
    const body = await readJsonBody(req);
    const dryRun =
      Boolean((body as { dryRun?: boolean }).dryRun) ||
      url.searchParams.get("dryRun") === "1";
    const request = validateUpdateRequest(body);
    const result = await applyUpdate(request, { dryRun });
    sendJson(res, 200, { ok: true, ...request, ...result });
    return;
  }

  if (method === "POST" && pathname === "/api/update-bulk") {
    const body = (await readJsonBody(req)) as {
      dryRun?: boolean;
      updates?: unknown[];
    };
    const dryRun = Boolean(body.dryRun);
    if (!Array.isArray(body.updates) || body.updates.length === 0) {
      sendJson(res, 400, { error: "updates array is required" });
      return;
    }

    const results = [];
    for (const item of body.updates) {
      const request = validateUpdateRequest(item);
      // Refuse silent major upgrades unless target is explicit exact chosen by client.
      const current = listDeclarations().find(
        (row) =>
          row.manifestId === request.manifestId &&
          row.dependency === request.dependency &&
          row.depType === request.depType,
      );
      if (!current) {
        throw new Error(`Declaration not found for ${request.dependency}`);
      }
      const currentParsed = parseSemVer(current.declared);
      const targetParsed = parseSemVer(request.targetVersion);
      if (
        currentParsed &&
        targetParsed &&
        targetParsed.major > currentParsed.major &&
        (item as { allowMajor?: boolean }).allowMajor !== true
      ) {
        throw new Error(
          `Refusing major upgrade for ${request.dependency} (${currentParsed.raw} → ${targetParsed.raw}) without allowMajor`,
        );
      }
      results.push({
        ...request,
        ...(await applyUpdate(request, { dryRun })),
      });
    }

    sendJson(res, 200, { ok: true, dryRun, results });
    return;
  }

  sendJson(res, 404, { error: `Unknown API route: ${pathname}` });
}

async function requestListener(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    if (!isLocalHost(req)) {
      sendJson(res, 403, { error: "Host not allowed" });
      return;
    }

    const url = new URL(req.url ?? "/", `http://${HOST}`);

    if ((req.method ?? "GET") === "GET" && url.pathname === "/") {
      const html = await fsp.readFile(INDEX_HTML, "utf8");
      sendText(res, 200, html, "text/html; charset=utf-8");
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function listen(port: number): void {
  const server = createServer((req, res) => {
    void requestListener(req, res);
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE" && port < PREFERRED_PORT + 20) {
      listen(port + 1);
      return;
    }
    console.error(error);
    process.exit(1);
  });

  server.listen(port, HOST, () => {
    console.log(`[monitor] css-doctor Dependency Monitor → http://${HOST}:${port}`);
    console.log("[monitor] Scope: root + packages/* (examples/ and Cargo excluded)");
  });
}

listen(PREFERRED_PORT);
