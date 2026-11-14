import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { GUI_STARTUP_REPORT_NAME } from "../src/utils/gui-startup-analysis";
import { runCheck } from "../src/commands/check";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(packageRoot, "dist", "index.js");
const repoGuiRoot = join(packageRoot, "..", "css-doctor-gui");
const fixtureCss = join(packageRoot, "test", "fixtures", "basic.css");
const issuesCss = join(packageRoot, "test", "fixtures", "issues.css");

async function withConsumerProject<T>(
  run: (cwd: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "cssd-gui-auto-"));
  try {
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify(
        {
          name: "css-doctor-gui-auto",
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
    await copyFile(issuesCss, join(directory, "issues.css"));
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

test("standalone css-doctor check behavior remains unchanged", async () => {
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

test("css-doctor gui --no-open runs check once and serves that report", async () => {
  await withConsumerProject(async (cwd) => {
    const port = await freePort();
    const child = spawn(
      process.execPath,
      [
        cliPath,
        "gui",
        "styles.css",
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
        /css-doctor gui: web mode/i,
        30_000,
      );

      assert.match(stdout, /running check/i);
      assert.match(stdout + stderr, new RegExp(GUI_STARTUP_REPORT_NAME));
      assert.match(stdout, /Browser:\s+skipped/i);

      const startupPath = join(
        cwd,
        ".css-doctor/reports",
        GUI_STARTUP_REPORT_NAME,
      );
      const startupStat = await stat(startupPath);
      const startup = JSON.parse(await readFile(startupPath, "utf8")) as {
        generatedAt: string;
        success: boolean;
        command: string;
      };
      assert.equal(startup.command, "check");
      assert.equal(startup.success, true);

      const response = await fetch(`http://127.0.0.1:${port}/api/report`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        ok: boolean;
        report: {
          metadata: { generatedAt?: string };
          source: { command: string };
        };
      };
      assert.equal(body.ok, true);
      assert.equal(body.report.source.command, "check");
      assert.equal(body.report.metadata.generatedAt, startup.generatedAt);

      // Browser/API refresh must not rerun check.
      const refresh = await fetch(`http://127.0.0.1:${port}/api/report`);
      assert.equal(refresh.status, 200);
      const after = await stat(startupPath);
      assert.equal(after.mtimeMs, startupStat.mtimeMs);
    } finally {
      child.kill("SIGTERM");
      await waitForExit(child, 5_000);
    }
  });
});

test("css-doctor gui still displays report when check finds CSS diagnostics", async () => {
  await withConsumerProject(async (cwd) => {
    const port = await freePort();
    const child = spawn(
      process.execPath,
      [
        cliPath,
        "gui",
        "issues.css",
        "--port",
        String(port),
        "--strict-port",
        "--no-open",
      ],
      {
        cwd,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
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
      await waitForMatch(() => stdout + stderr, /web mode/i, 30_000);
      const response = await fetch(`http://127.0.0.1:${port}/api/report`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        ok: boolean;
        report: {
          metadata: { success?: boolean; errors: string[] };
          diagnosticCounts: { total: number };
        };
      };
      assert.equal(body.ok, true);
      assert.equal(body.report.metadata.success, true);
      assert.equal(body.report.metadata.errors.length, 0);
      assert.ok(body.report.diagnosticCounts.total > 0);
    } finally {
      child.kill("SIGTERM");
      await waitForExit(child, 5_000);
    }
  });
});

test("analysis execution failure loads this-run report and keeps prior latest", async () => {
  await withConsumerProject(async (cwd) => {
    const prior = await runCheck(["styles.css"], { cwd });
    assert.equal(prior.success, true);
    const { persistCliReport } = await import("../src/utils/report-io");
    await persistCliReport(prior, { save: true, cwd });
    const latestPath = join(cwd, ".css-doctor/reports/check-latest.json");
    const priorLatest = await readFile(latestPath, "utf8");

    const port = await freePort();
    const child = spawn(
      process.execPath,
      [
        cliPath,
        "gui",
        "does-not-exist-*.css",
        "--port",
        String(port),
        "--strict-port",
        "--no-open",
      ],
      {
        cwd,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
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
      await waitForMatch(() => stdout + stderr, /web mode/i, 30_000);
      assert.match(
        stdout + stderr,
        /previous check-latest\.json .* left unchanged/i,
      );

      const response = await fetch(`http://127.0.0.1:${port}/api/report`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        ok: boolean;
        report: {
          metadata: {
            success?: boolean;
            errors: string[];
            generatedAt?: string;
          };
        };
      };
      assert.equal(body.ok, true);
      assert.equal(body.report.metadata.success, false);
      assert.ok(body.report.metadata.errors.length > 0);

      const startup = JSON.parse(
        await readFile(
          join(cwd, ".css-doctor/reports", GUI_STARTUP_REPORT_NAME),
          "utf8",
        ),
      ) as { generatedAt: string; success: boolean };
      assert.equal(startup.success, false);
      assert.equal(body.report.metadata.generatedAt, startup.generatedAt);
      assert.equal(await readFile(latestPath, "utf8"), priorLatest);
    } finally {
      child.kill("SIGTERM");
      await waitForExit(child, 5_000);
    }
  });
});

test("css-doctor gui --desktop runs startup analysis before launch attempt", async () => {
  await withConsumerProject(async (cwd) => {
    const result = runCli(["gui", "styles.css", "--desktop"], cwd);
    // Desktop binary is usually absent in CI; analysis must still complete first.
    assert.match(result.stdout + result.stderr, /running check/i);
    assert.match(
      result.stdout + result.stderr,
      new RegExp(GUI_STARTUP_REPORT_NAME),
    );
    const startup = JSON.parse(
      await readFile(
        join(cwd, ".css-doctor/reports", GUI_STARTUP_REPORT_NAME),
        "utf8",
      ),
    ) as { success: boolean; command: string };
    assert.equal(startup.command, "check");
    assert.equal(startup.success, true);
    assert.match(result.stdout + result.stderr, /desktop/i);
  });
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
