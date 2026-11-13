import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(packageRoot, "dist", "index.js");
const repoGuiRoot = join(packageRoot, "..", "css-doctor-gui");
const fixtureCss = join(packageRoot, "test", "fixtures", "basic.css");

async function withConsumerProject<T>(
  run: (cwd: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "cssd-gui-proj-"));
  try {
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify(
        {
          name: "css-doctor-gui-consumer",
          private: true,
          type: "module",
          devDependencies: {
            "@zealakit/css-doctor-gui": "file:../unused",
          },
        },
        null,
        2,
      ),
    );
    await mkdir(join(directory, "node_modules", "@zealakit"), {
      recursive: true,
    });
    await symlink(
      repoGuiRoot,
      join(directory, "node_modules", "@zealakit", "css-doctor-gui"),
      "dir",
    );
    await copyFile(fixtureCss, join(directory, "styles.css"));
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runCli(
  args: string[],
  cwd: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

test("existing CLI commands work from a consumer project with GUI installed", async () => {
  await withConsumerProject(async (cwd) => {
    const result = runCli(["check", "styles.css", "--json"], cwd);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout) as {
      command: string;
      success: boolean;
    };
    assert.equal(report.command, "check");
    assert.equal(report.success, true);
  });
});

test("css-doctor gui resolves GUI from consumer node_modules and serves production assets", async () => {
  await withConsumerProject(async (cwd) => {
    const port = await freePort();
    const child = spawn(
      process.execPath,
      [
        cliPath,
        "gui",
        "--port",
        String(port),
        "--strict-port",
        "--no-open",
        "--host",
        "127.0.0.1",
      ],
      {
        cwd,
        env: {
          ...process.env,
          FORCE_COLOR: "0",
          NO_COLOR: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    try {
      await waitForMatch(
        () => stdout + stderr,
        /css-doctor gui: web mode|listening on/i,
        15_000,
      );

      assert.match(stdout, /web mode/i);
      assert.match(stdout, new RegExp(`Port:\\s+${port}`));
      assert.doesNotMatch(stdout + stderr, /analyzeCss|running analysis/i);

      const health = await fetchJson(`http://127.0.0.1:${port}/api/health`);
      assert.equal(health.ok, true);
      assert.equal(health.service, "css-doctor-gui");

      const index = await fetchText(`http://127.0.0.1:${port}/`);
      assert.match(index, /<!doctype html>/i);
      assert.match(index, /css doctor|root/i);
    } finally {
      child.kill("SIGTERM");
      await waitForExit(child, 5_000);
    }
  });
});

test("css-doctor gui without GUI installed prints actionable install help", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cssd-gui-absent-"));
  try {
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name: "no-gui", private: true }, null, 2),
    );

    // Isolate secondary resolve so CLI monorepo devDependency cannot satisfy.
    const isolated = join(directory, "fake-cli-home");
    await mkdir(isolated, { recursive: true });
    await writeFile(join(isolated, "index.js"), "export {};\n");

    const { resolveGuiServerEntry } = await import("../src/utils/resolve-gui");
    const resolved = resolveGuiServerEntry({
      cwd: directory,
      fromModuleUrl: join(isolated, "index.js"),
    });
    assert.equal(resolved.ok, false);
    if (resolved.ok) {
      return;
    }
    assert.match(resolved.message, /CSS Doctor GUI is not installed/);
    assert.match(
      resolved.message,
      /add -D @zealakit\/css-doctor-gui|install -D @zealakit\/css-doctor-gui/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForMatch(
  read: () => string,
  pattern: RegExp,
  timeoutMs: number,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (pattern.test(read())) {
      return;
    }
    await delay(50);
  }
  throw new Error(
    `Timed out waiting for ${pattern}. Output:\n${read().slice(0, 2000)}`,
  );
}

function waitForExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  assert.equal(response.ok, true, `GET ${url} -> ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  assert.equal(response.ok, true, `GET ${url} -> ${response.status}`);
  return await response.text();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
