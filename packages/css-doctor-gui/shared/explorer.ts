import type { GuiExplorerFile, GuiReport } from "./report-model";

/** Builds a unified file list from whatever sections the report provides. */
export function buildExplorerFiles(report: GuiReport): GuiExplorerFile[] {
  const map = new Map<string, GuiExplorerFile>();

  const ensure = (path: string): GuiExplorerFile => {
    const existing = map.get(path);
    if (existing) {
      return existing;
    }
    const created: GuiExplorerFile = {
      path,
      hasAnalysis: false,
      hasOptimization: false,
      hasSplitting: false,
      hasRegression: false,
      chunkNames: [],
      diagnosticCount: 0,
    };
    map.set(path, created);
    return created;
  };

  if (report.files) {
    for (const file of report.files) {
      const row = ensure(file.path);
      row.sizeBytes = file.sizeBytes;
      row.selectorCount = file.selectorCount;
      row.declarationCount = file.declarationCount;
      row.diagnosticCount = file.issueCount;
    }
  }

  if (report.cssAnalysis) {
    for (const file of report.cssAnalysis.files) {
      const row = ensure(file.path);
      row.hasAnalysis = true;
      row.sizeBytes = file.sizeBytes;
      row.selectorCount = file.selectorCount;
      row.declarationCount = file.declarationCount;
      row.diagnosticCount = Math.max(row.diagnosticCount ?? 0, file.issueCount);
    }
  }

  for (const diagnostic of report.diagnostics) {
    if (!diagnostic.filePath) {
      continue;
    }
    const row = ensure(diagnostic.filePath);
    row.diagnosticCount = (row.diagnosticCount ?? 0) + 1;
  }

  if (report.optimization) {
    for (const file of report.optimization.files) {
      const row = ensure(file.path);
      row.hasOptimization = true;
      row.sizeBytes = row.sizeBytes ?? file.inputBytes;
      row.chunkNames = Array.from(
        new Set([...row.chunkNames, ...file.chunks.map((chunk) => chunk.name)]),
      );
    }
  }

  if (report.splitting) {
    for (const chunk of report.splitting.chunks) {
      const row = ensure(chunk.sourceFile);
      row.hasSplitting = true;
      row.chunkNames = Array.from(new Set([...row.chunkNames, chunk.name]));
    }
  }

  if (report.regression?.files) {
    const mark = (
      entries: Array<{ path: string; qualityRegressed: boolean }>,
    ) => {
      for (const entry of entries) {
        const row = ensure(entry.path);
        row.hasRegression = true;
        if (entry.qualityRegressed) {
          row.qualityRegressed = true;
        }
      }
    };
    mark(report.regression.files.added);
    mark(report.regression.files.removed);
    mark(report.regression.files.modified);
    mark(report.regression.files.regressed);
  }

  return Array.from(map.values()).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}
