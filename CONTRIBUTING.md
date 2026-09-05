# Contributing

Thanks for helping. Bug reports, ideas and pull requests all go through GitHub issues and PRs; `main` only
changes through a reviewed pull request with green CI.

## Development

```sh
npm install
npm run build        # extension → yurei-extension/dist, CLI → yurei-kit/dist/yurei.mjs
npm run typecheck
npm run lint         # Biome: formatting and lint rules; `npm run format` fixes what it can
npm test             # unit tests with node:test, against the sources and the built CLI
sh install.sh        # registers this checkout's build with Chrome and runs the setup wizard
```

After changing the extension, run `npm run build` and then `yurei reload-extension` to reload it in Chrome.
`yurei call <tool> '<json>'` runs one browser tool by hand, for example `yurei call navigate '{"url":"example.com"}'`,
and `yurei doctor` checks the whole chain from the CLI to your tabs.

Test installer changes against a throwaway home so your own configs stay untouched:

```sh
HOME=$(mktemp -d) XDG_CONFIG_HOME=$HOME/.config node yurei-kit/dist/yurei.mjs setup
```

## Layout

- `yurei-extension/` the Chrome extension (Manifest V3, TypeScript). `fonts/` and `icons/` are copied into `dist/`.
- `yurei-kit/` the `yurei` command: native host, MCP server and setup wizard, published to npm as `yurei-chrome`.
- `shared/protocol.ts` the messages the two exchange.
- `test/` unit tests for the pure modules and the CLI. What needs a real Chrome is tested by hand, see below.
- `assets/` the logo, also used by the [website](https://yurei.web.app).

## Style

- TypeScript, strict. No `any`, no `@ts-ignore`, `unknown` only with narrowing, `readonly` where data does not change.
- [Biome](https://biomejs.dev) formats and lints everything (`biome.jsonc`); run `npm run format` before committing, CI runs `npm run lint`.
- Comments explain why, never what. Delete dead code instead of commenting it out.
- The popup, the in-page indicator and the website share one look: night `#0a0b12`, paper `#f2ecdf`, glow blue
  `#4274f2`, seal red `#c73a27`, Shippori Mincho B1 for titles and Yuji Syuku for the kanji. Both fonts are
  subsets under the SIL Open Font License, see `yurei-extension/fonts/OFL.txt`.
- No third-party brand names in example prompts.

## Pull requests

- Title and commits follow [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`,
  `refactor:`, `chore:`. PRs are squash-merged, so the PR title becomes the commit.
- Keep a PR to one change. Say how you tested it in Chrome.
- CI typechecks, lints, tests and builds, packs the extension, and runs the built CLI through its installed launcher
  on Linux with Node.js 18 and 24 and on Windows with Node.js 22.

## Releasing

1. Bump the version in `yurei-extension/manifest.json` and `yurei-kit/package.json`
   (`npm version X.Y.Z -w yurei-kit --no-git-tag-version`), turn the `[Unreleased]` section of `CHANGELOG.md` into
   `## [X.Y.Z] - <date>` with its link at the bottom, and merge that as `chore: release X.Y.Z`.
2. Tag the merge commit `vX.Y.Z` and push the tag. `release.yml` checks that the tag matches both versions and has a
   changelog section, runs typecheck, lint, tests and build, packs the extension, creates the GitHub release with the
   changelog section as notes and both zips attached, and publishes `yurei-chrome` to npm with provenance. npm accepts
   the workflow through trusted publishing, configured once on npmjs.com for this repository and `release.yml`, so no
   token lives in the repository. Every step is safe to repeat: re-run the workflow if one fails.
3. Upload `yurei-extension-store.zip` from the release to the Chrome Web Store developer console. `yurei-extension.zip`
   keeps the `key` in `manifest.json`, which fixes the id an unpacked folder gets and the native host trusts; the store
   minted its own id for the listing and refuses an upload that carries a key, so the store zip drops it.
4. Remove the "not in the Chrome Web Store yet" note from the README once the listing is live.
5. Users get the extension from the store by itself and are told to run `yurei update` for the CLI. Bump `PROTOCOL`
   in `shared/protocol.ts` only when a message changes in a way the other side cannot ignore; both sides then report
   the mismatch to the user instead of failing silently, so keep new fields optional when you can.
