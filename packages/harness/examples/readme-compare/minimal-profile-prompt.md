Create `README.md` for this package and change no other repository file.

Ground every claim in `package.json`, `src/index.mjs`, `src/retry.mjs`,
`test/retry.test.mjs`, and `examples/basic.mjs`. Include Purpose, Installation,
Quick Start, API, Behavior, and Verification sections. The Quick Start must be
an executable ESM JavaScript example. The Installation section must show the
consumer command `npm install @fixture/retry-kit`. Document retry defaults and
abort behavior precisely.

Do not copy claims from `docs/archive-v0.md`. Do not invent a CLI, CommonJS
support, badges, remote URLs, network behavior, or unimplemented API. Run the
repository's allowed validation before completing.

The bounded Bash policy accepts these validation commands exactly: `npm test`,
`npm run example`, `node --test`, `node examples/basic.mjs`,
`node ./examples/basic.mjs`, `git status --short`, and `git diff --check`.
Use the repository-inspection tools available in the current runtime profile;
do not probe for hidden tools or unsupported shell commands.
