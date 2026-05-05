# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Docusaurus 3.10** technical wiki (not a blog), serving as a knowledge base for AI Agent development. The site is deployed to GitHub Pages via `pnpm` build pipeline.

- **Language**: All content is in Chinese (zh-Hans)
- **Default branch**: `master`
- **Package manager**: `pnpm` (v9)
- **Node**: >= 20

## Commands

```bash
pnpm install          # Install dependencies
pnpm start            # Start dev server (localhost:3000)
pnpm build            # Build static site to ./build
pnpm serve            # Serve built site locally
pnpm clear            # Clear Docusaurus cache
```

No lint, test, or typecheck scripts are configured.

## Architecture

**Docs as homepage**: `docusaurus.config.js` sets `routeBasePath: '/'`, so `docs/` content is served at the root. `docs/intro.md` (with `slug: /`) is the landing page.

**Custom homepage**: `src/pages/index.js` renders the actual homepage with hero banner, featured articles, and full article grid. It imports from `ArticleList` component.

**Article catalog**: `src/components/ArticleList/index.js` contains the `groups` array — the single source of truth for homepage article display. It organizes 60+ articles into 5 top-level groups with 8 sub-categories. All articles in `groups` must be listed here.

**Sidebar**: `sidebars.js` defines `aiSidebar` with 16 categories, matching `docs/` subdirectories. Each category has a `_category_.json` for metadata.

**CI/CD**: Single workflow (`.github/workflows/deploy.yml`) triggers on push to `master`, builds with pnpm, deploys to GitHub Pages.

## Content Conventions

### Frontmatter (required for every doc)

```yaml
---
sidebar_position: <number>
slug: <english-slug>   # ALWAYS required — never use Chinese paths
---
```

### Doc ID format

In `ArticleList` and `FeaturedArticles`, use `category/slug` format (e.g., `ai-native-pipeline/pipeline-design`). Never use Chinese filenames or bare slugs as docId.

### Category metadata

Each `docs/<category>/` directory should have a `_category_.json`:

```json
{
  "label": "Category Name",
  "position": 1,
  "link": {
    "type": "generated-index",
    "description": "Category description"
  }
}
```

## Key Patterns

- Article filenames use Chinese characters (e.g., `Agent-错误处理与重试机制.md`), but `slug` in frontmatter is always English
- `ArticleCard` component renders cards using `docId` for navigation links
- `ArticleList` exports both `categories` (flat) and `groups` (hierarchical) for different use cases
- CSS modules are used for component styling (`*.module.css`)
- Infima CSS variables are overridden in `src/css/custom.css` for theme customization
