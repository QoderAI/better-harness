#!/usr/bin/env node

import { main } from "./cli.mjs";

process.exitCode = await main(["verify-run", ...process.argv.slice(2)]);
