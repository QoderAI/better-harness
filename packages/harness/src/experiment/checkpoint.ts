/**
 * What a checkpoint actually pins down, and what it leaves out.
 *
 * A Git checkpoint anchors a commit and a tree. It does not anchor the untracked
 * files, unstaged edits, or installed dependencies the historical trajectory may
 * have started from. Fresh lanes therefore cannot claim to share an observed
 * lane's starting condition unless the gap was measured, so materialization
 * records which of these three cases held.
 */
export type CheckpointCompleteness =
  /** The working tree matched the checkpoint tree exactly. */
  | { kind: "clean-tree"; verifiedAt: string }
  /**
   * The working tree differed, and the difference was captured as a patch that
   * every fresh lane applies identically. The lanes still share a start.
   */
  | { kind: "dirty-state-patch"; verifiedAt: string; patchSha256: string; changedPaths: string[] }
  /**
   * The gap could not be measured. Lanes may still be compared to each other,
   * but none of them may claim to reproduce an observed trajectory's start.
   */
  | { kind: "unverified"; reason: string };

/**
 * Whether fresh lanes may claim to start where the observed trajectory started.
 *
 * This is the gate that keeps an `unverified` receipt from quietly promoting a
 * historical trajectory into a matched baseline.
 */
export function reproducesObservedStart(completeness: CheckpointCompleteness): boolean {
  return completeness.kind !== "unverified";
}

export function describeCheckpointCompleteness(completeness: CheckpointCompleteness): string {
  switch (completeness.kind) {
    case "clean-tree":
      return "working tree matched the checkpoint tree";
    case "dirty-state-patch":
      return `dirty state captured as a patch over ${completeness.changedPaths.length} path(s)`;
    case "unverified":
      return `checkpoint completeness unverified: ${completeness.reason}`;
  }
}
