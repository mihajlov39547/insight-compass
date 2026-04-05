# Insight Navigator

Insight Navigator is a notebook-style LLM workspace for creating projects, uploading source documents, and asking questions grounded in those files.

## What it does

- Create a project and organize related documents in one workspace
- Upload PDFs and other files for analysis
- Ask questions and get answers based on uploaded content
- Search across your files with advanced semantic retrieval
- Support research, documentation review, and knowledge discovery

## Tech stack

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## Local development

The only requirement is Node.js and npm. You can install Node.js with [nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
npm install
npm run dev
```

## Environment configuration

Supabase configuration is centralized in [src/config/env.ts](src/config/env.ts).

Resolution order:

1. Vite build env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
2. Runtime overrides from [public/env.js](public/env.js) (`window.__ENV__`)
3. Hardcoded fallback values in [src/config/env.ts](src/config/env.ts)

For hosted preview environments (including Lovable preview), update [public/env.js](public/env.js) to manage runtime values in one place.

## Build

```sh
npm run build
```

## Documentation

Primary project documentation is consolidated into:

1. `README.md` - project overview and local development
2. `DOC_PROCESSING.md` - current document ingestion, indexing, and retrieval behavior
3. `docs/workflows/document-analysis-status.md` - workflow activity usage, readiness, partial/deferred items, and pending work

## Notes

This project is intended to evolve into a document intelligence assistant for project-based workflows, including grounded answers, cross-file search, and file-aware chat.
