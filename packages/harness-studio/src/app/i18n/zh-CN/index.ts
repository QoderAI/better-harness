import { artifacts } from "./artifacts.js";
import { artifactViewers } from "./artifact-viewers.js";
import { common } from "./common.js";
import { compare } from "./compare.js";
import { customize } from "./customize.js";
import { experiment } from "./experiment.js";
import { git } from "./git.js";
import { inspector } from "./inspector.js";
import { run } from "./run.js";
import { sessions } from "./sessions.js";
import { workspace } from "./workspace.js";

export const namespaces = {
  common,
  workspace,
  sessions,
  compare,
  artifacts,
  artifactViewers,
  customize,
  git,
  inspector,
  run,
  experiment,
} as const;