import { Command, CommanderError } from "commander";

import packageJson from "../package.json";
import { registerBaselineCommand } from "./commands/baseline";
import { registerCheckCommand } from "./commands/check";
import { registerDiffCommand } from "./commands/diff";
import { registerFixCommand } from "./commands/fix";
import { registerHealthCommand } from "./commands/health";
import {
  registerOptimizeCommand,
  registerSplitCommand,
} from "./commands/optimize";

const program = new Command();

program
  .name("css-doctor")
  .description(
    "Diagnose, score, regress, explain, and safely optimize CSS with a native LightningCSS engine",
  )
  .version(packageJson.version, "-v, --version", "Output the version number")
  .showHelpAfterError("(run with --help for usage information)")
  .showSuggestionAfterError()
  .exitOverride();

registerCheckCommand(program);
registerHealthCommand(program);
registerBaselineCommand(program);
registerDiffCommand(program);
registerOptimizeCommand(program);
registerSplitCommand(program);
registerFixCommand(program);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    // Commander has already printed help/version output or an error message.
    process.exitCode = error.exitCode;
  } else {
    printUncaughtError(error);
    process.exitCode = 1;
  }
}

function printUncaughtError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`css-doctor: ${message}\n`);
}
