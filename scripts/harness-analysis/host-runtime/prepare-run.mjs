#!/usr/bin/env node

import { main } from "./cli.mjs";

process.exitCode = await main(["prepare-run", ...process.argv.slice(2)]);
