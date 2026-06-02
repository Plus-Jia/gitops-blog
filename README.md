# GitOps Blog

This website is built using [Docusaurus](https://docusaurus.io/), a modern static website generator.

The site also includes a lightweight Decap CMS admin UI at `/admin/`.
Editors can create Markdown documents or blog posts in the browser, publish them to this repository, and let the existing GitOps workflow build and deploy the new version.

## Installation

Use the project-local Node.js runtime:

```bash
source scripts/env.sh
```

```bash
npm install
```

## Local Development

```bash
npm run start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

## Build

```bash
npm run build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

## CMS Admin

The admin UI is served from `src/pages/admin.tsx`, and the CMS configuration is served from `static/admin`.

- `src/pages/admin.tsx` loads Decap CMS.
- `static/admin/config.yml` maps CMS forms to `docs/` and `blog/`.
- Uploaded files are stored in `static/uploads` and served from `/uploads`.

After a CMS publish, Decap CMS commits to the configured GitHub branch. The existing GitHub Actions workflow then builds the Docker image, pushes it to GHCR, and updates the GitOps manifests repository.

Before production use, configure OAuth or Git Gateway for the CMS backend and limit editor access to approved users.

## Deployment

Using SSH:

```bash
USE_SSH=true yarn deploy
```

Not using SSH:

```bash
GIT_USER=<Your GitHub username> yarn deploy
```

If you are using GitHub pages for hosting, this command is a convenient way to build the website and push to the `gh-pages` branch.
