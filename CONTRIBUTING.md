# Contributing to Ronde

Thanks for helping. Bug reports, ideas and pull requests are welcome.

## Reporting a bug or asking for something

Open an issue with the version of Ronde (the image tag, or the commit), whether it runs in the cloud or on your
own server, what you did, what you expected and what happened. Screenshots help.

Please do not report security issues in public: see [SECURITY.md](SECURITY.md).

## Working on the code

Requirements: Node.js 22, pnpm 10 and Docker. `make dev` installs everything, starts PostgreSQL and serves the
app on http://localhost:3000 with a demo workspace (sign in as `host@example.com`, password
`ronde-demo-password`). The [README](README.md#local-development) has the details.

Before opening a pull request, run the checks relevant to your change:

```bash
make lint typecheck test
make test-integration   # against PostgreSQL, started for it
make e2e                # browser flows
```

## Conventions

- Code, comments, commit messages and default texts are in English. `pnpm check:english` finds French left
  outside the French catalogs.
- Every text shown to people goes through the catalogs in `packages/i18n/messages/<locale>/`, in the ten
  languages; `pnpm --filter @ronde/i18n generate` updates their index. If you cannot translate a language,
  say so in the pull request.
- A change in behavior comes with a test: unit tests next to the code, integration tests in
  `apps/web/tests`, browser flows in `apps/web/e2e`.
- The paid editions' code lives in `ee/`; nothing outside `apps/web/src/ee-bridge.ts` imports it
  (`node scripts/check-ee-boundary.mjs` checks it).

## License of contributions

A contribution is licensed under the license of the code it touches: the [GNU AGPL v3](LICENSE) for the core,
the [Ronde Enterprise License](ee/LICENSE) for `ee/`.
