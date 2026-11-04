import { Command, CommanderError } from "commander";

import packageJson from "../package.json";
import { registerCheckCommand } from "./commands/check";
import { registerHealthCommand } from "./commands/health";

const program = new Command();

program
  .name("css-doctor")
  .description(
    "Diagnose CSS stylesheets and evaluate CSS Health Score with a native lightningcss engine",
  )
  .version(packageJson.version, "-v, --version", "Output the version number")
  .showHelpAfterError("(run with --help for usage information)")
  .showSuggestionAfterError()
  .exitOverride();

registerCheckCommand(program);
registerHealthCommand(program);

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
