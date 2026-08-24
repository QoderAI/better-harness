Create `README.md` for this package. Change no other repository file.

Runtime policy for this environment, identical for every harness: the
bounded Bash policy accepts these validation commands exactly: `npm test`,
`npm run example`, `node --test`, `node examples/basic.mjs`,
`node ./examples/basic.mjs`, `git status --short`, and `git diff --check`.
Every other command is denied. Use the dedicated Read, Glob, and Grep tools for
repository inspection.

What a good README must contain is not stated here: that expectation belongs to
the harness under comparison, not to the shared task.
