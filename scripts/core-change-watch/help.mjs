const CORE_CHANGE_WATCH_HELP = Object.freeze({
  "change-drift": "Compare the current repository state with a base revision.",
  "core-candidates": "Identify paths that merit core-change review.",
  "diff-impact": "Estimate the impact of changes from a base revision.",
  "evidence-pack": "Build a bounded project and history evidence pack.",
  "git-history-profile": "Summarize repository history and churn evidence.",
  "project-profile": "Summarize the repository's static project profile.",
  "qoder-consistency-schema": "Validate and normalize a Qoder consistency result.",
});

export function printCoreChangeWatchHelp(command, argv = []) {
  if (!argv.some((value) => value === "--help" || value === "-h")) {
    return false;
  }

  const summary = CORE_CHANGE_WATCH_HELP[command];
  if (!summary) {
    throw new Error(`Unknown core-change-watch help owner: ${command}`);
  }

  const input = command === "qoder-consistency-schema" ? " --input <path>" : "";
  process.stdout.write(`Usage: better-harness core-change-watch ${command}${input} [options]\n\n${summary}\n\nOptions:\n  --cwd <path>              Analyze a repository from this directory\n  --json                    Emit JSON output\n  -h, --help                Print help\n`);
  return true;
}
