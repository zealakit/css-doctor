export { describeError } from "./describe-error";
export { matchesPatterns } from "./matches-patterns";
export {
  DEFAULT_MAX_CHUNK_SIZE,
  DEFAULT_MIN_PAGE_RATIO,
  clampMaxChunkSize,
  clampMinPageRatio,
} from "./pipeline-options";
export type { ClampResult } from "./pipeline-options";
export {
  extractClassLiterals,
  extractFrameworkClassBinding,
} from "./extract-class-literals";
export type { ClassLiteralExtraction } from "./extract-class-literals";
export {
  isClassToken,
  scanClasses,
  scanClassOccurrences,
  setActiveClassHelpers,
} from "./scan-classes";
export {
  createMarkupUsageBucket,
  scanAttributeOccurrences,
  scanIdOccurrences,
  scanMarkupUsage,
  scanTagOccurrences,
} from "./scan-markup-usage";
export type {
  MarkupUsageBucket,
  MarkupUsageKind,
} from "./scan-markup-usage";
export { scanSourceEvidence } from "./scan-source-evidence";
export {
  DEFAULT_CLASS_HELPERS,
  normalizeClassHelpers,
  scanClassHelpers,
} from "./scan-class-helpers";
export type {
  ClassHelperCall,
  ClassHelperScan,
  UnknownEvidence,
} from "./scan-class-helpers";
export type {
  ScanSourceEvidenceOptions,
  SourceElementEvidence,
  SourceFileEvidence,
} from "./scan-source-evidence";
export {
  SELECTOR_ANALYSIS_SCHEMA_VERSION,
  aggregateSelectorMetrics,
  categorizeSelectorKinds,
  categorizeSelectorText,
  emptySymbolBags,
  legacyClassOnlyAnalysis,
  normalizeLevelAndSources,
  parseSelectorAnalysis,
} from "./selector-analysis-contract";
export type {
  ParseSelectorAnalysisResult,
  SelectorAnalysisCompleteness,
  SelectorConfidenceLevel,
  SelectorEvidenceSource,
  SelectorAnalysisMetrics,
  SelectorAnalysisRecord,
  SelectorAnalysisReport,
  SelectorAnalysisSchemaVersion,
  SelectorCategory,
  SelectorDefinitionLocation,
  SelectorFileHit,
  SelectorMatchConfidence,
  SelectorSymbolBags,
  SelectorUsageStatus,
} from "./selector-analysis-contract";
export { buildSelectorAnalysisReport } from "./build-selector-analysis";
export type {
  BuildSelectorAnalysisInput,
  SelectorDefinitionInput,
  SelectorMatchInput,
} from "./build-selector-analysis";
export { createModuleResolver } from "./resolve-module";
export type {
  ModuleResolver,
  ModuleResolverOptions,
  ResolveResult,
} from "./resolve-module";
export { isCssModuleSpecifier, scanCssModuleUsage } from "./scan-css-modules";
export type { CssModuleUsage } from "./scan-css-modules";
export {
  CssModuleRegistry,
  extractCssModuleLocals,
} from "./css-module-registry";
export type { CssModuleLocals } from "./css-module-registry";
