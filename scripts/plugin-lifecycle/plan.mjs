#!/usr/bin/env node

import { runPluginCommand } from "./cli.mjs";

process.exitCode = await runPluginCommand("plan");
