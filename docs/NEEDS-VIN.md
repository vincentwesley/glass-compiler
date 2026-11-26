# Needs Vin

Steps only the repository owner can take. Everything works without them unless
an item says otherwise. Newest first.

## Required

_Nothing is required right now._ The restructure keeps the repo name, the Pages
source (GitHub Actions) and every existing URL, so the site keeps deploying as
before.

## Recommended

1. **Branch protection check names changed (only if you use branch protection).**
   The single `CI` workflow became one workflow per package. If `main` requires the
   old status check **"Typecheck, lint, test, build"**, replace it:
   - Go to https://github.com/vincentwesley/glass-compiler/settings/branches.
   - Edit the rule for `main`.
   - Under "Require status checks", remove "Typecheck, lint, test, build" and
     add **"Glass Compiler"**, **"glass-ui"**, **"Glass Wasm"**, **"Small C"**
     and **"Hub and site"** (one per package workflow).

   Path filters mean a check only appears when its package changed, so mark them
   required only if you are happy for docs-only PRs to show them as "expected".

## Optional

1. **A custom domain for the series** (for example `glass.vwesley.dev`). This is
   not needed and is not planned. If you ever want it, the hub could live at `/`
   and the compiler at `/compiler/`. Steps:
   1. Add a DNS `CNAME` record from `glass.vwesley.dev` to
      `vincentwesley.github.io`.
   2. In https://github.com/vincentwesley/glass-compiler/settings/pages, set
      **Custom domain** to `glass.vwesley.dev` and tick **Enforce HTTPS**.
   3. Tell a session to switch `SITE.base` in `site.config.mjs` and add redirect
      pages.

   The old `vincentwesley.github.io/glass-compiler/` URL redirects to a custom
   domain automatically, but share links' `#code=` fragments survive only on the
   same path.
2. **Do not rename the repository.** GitHub does not redirect Pages project sites
   after a rename, so every existing link would break (docs/DECISIONS.md S2).

## Later milestones (heads-up, nothing to do yet)

- **M7 Language Tools:** publishing the VS Code extension needs your accounts:
  - A Visual Studio Marketplace publisher at https://marketplace.visualstudio.com/manage,
    plus a personal access token stored as an Actions secret.
  - An Open VSX namespace at https://open-vsx.org, plus its token.

  The session will build the `.vsix` and write the exact commands.
