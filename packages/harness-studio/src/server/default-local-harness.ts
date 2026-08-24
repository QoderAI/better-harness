/** Stable ids and source for the zero-configuration local Web Debugger. */
export const DEFAULT_LOCAL_HARNESS_ID = "studio-local";
export const DEFAULT_LOCAL_RUNTIME_ID = "qoder";
export const DEFAULT_LOCAL_ACP_RUNTIME_ID = "acp";

export const DEFAULT_LOCAL_HARNESS_SOURCE = `
language 0.3

skill workspace-grounding {
  description "Work inside the selected project workspace. Inspect relevant files before changing them and keep edits scoped to the user's request."
}

skill verification-before-complete {
  description "Do not report completion until tests or a focused diff review provide verification evidence."
}

workflow local-session {
  session coder
}

harness ${DEFAULT_LOCAL_HARNESS_ID} {
  workflow local-session

  agent coder {
    use skill workspace-grounding
    use skill verification-before-complete
  }
}

runtime ${DEFAULT_LOCAL_RUNTIME_ID} {
  adapter "@harness/adapter-qoder"
}

deployment ${DEFAULT_LOCAL_HARNESS_ID}-${DEFAULT_LOCAL_RUNTIME_ID} {
  harness ${DEFAULT_LOCAL_HARNESS_ID}
  runtime ${DEFAULT_LOCAL_RUNTIME_ID}
}
`;

/** Prompt-session counterpart used only by an explicitly configured ACP Agent. */
export const DEFAULT_LOCAL_ACP_HARNESS_SOURCE = `
language 0.3

skill workspace-grounding {
  description "Work inside the selected project workspace. Inspect relevant files before changing them and keep edits scoped to the user's request."
}

skill verification-before-complete {
  description "Do not report completion until tests or a focused diff review provide verification evidence."
}

workflow local-session {
  session coder
}

harness ${DEFAULT_LOCAL_HARNESS_ID} {
  workflow local-session

  agent coder {
    use skill workspace-grounding
    use skill verification-before-complete
  }
}

runtime ${DEFAULT_LOCAL_ACP_RUNTIME_ID} {
  adapter "@harness/adapter-acp"
}

deployment ${DEFAULT_LOCAL_HARNESS_ID}-${DEFAULT_LOCAL_ACP_RUNTIME_ID} {
  harness ${DEFAULT_LOCAL_HARNESS_ID}
  runtime ${DEFAULT_LOCAL_ACP_RUNTIME_ID}
}
`;
