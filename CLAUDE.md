# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Docusaurus 3.10 static site for a personal tech blog focused on AI Agent architecture and LangGraph engineering practices. Deployed to GitHub Pages at https://afine907.github.io/afine907-wiki/.

## Common Commands

```bash
npm install        # Install dependencies
npm start          # Start dev server (default: http://localhost:3000/afine907-wiki/)
npm run build      # Build static site to build/
npm run serve      # Serve built site locally
npm run clear      # Clear Docusaurus cache (fixes stale build issues)
```

## Architecture

- **Content**: `docs/` contains all articles in Markdown/MDX, organized by topic in subdirectories with `_category_.json` for sidebar metadata
- **Homepage**: `src/pages/index.js` renders a custom homepage with featured articles and full article list
- **Components**: `src/components/ArticleCard/` and `ArticleList/` render article grids on the homepage
- **Routing**: Docs are served at root (`routeBasePath: '/'` in docusaurus.config.js), not under `/docs/`
- **Sidebar**: `sidebars.js` defines a single `aiSidebar` with 6 categories for navigation
- **Blog**: Disabled in this project (`blog: false` in preset config)

## Key Configuration

- Locale: `zh-Hans` (Chinese Simplified) — all content is in Chinese
- Search: Uses `@easyops-cn/docusaurus-search-local` plugin for offline search
- Docusaurus v4 future flag is enabled (`future.v4: true`)

## Adding New Articles

Three files must be kept in sync: the markdown file, `sidebars.js`, and `src/components/ArticleList/index.js`.

1. **Create the markdown file** in `docs/<category>/` with frontmatter:
   ```yaml
   ---
   sidebar_position: N
   title: 文章标题
   slug: english-url-slug     # REQUIRED — every doc must have a slug
   ---
   ```
2. **Add doc ID to `sidebars.js`** — use the file path format `category/filename` (no extension):
   ```js
   items: ['category/article-name', ...]
   ```
3. **Add entry to `ArticleList/index.js`** — use `category/slug` as `docId`:
   ```js
   { docId: 'category/english-url-slug', title: '文章标题', description: '一句话描述' }
   ```
4. Run `npm run build` to verify — no broken link warnings for the new article.

### Slug & docId Rules

- **Every doc MUST have a `slug` in frontmatter** — no exceptions. Docusaurus generates bad URLs (Chinese characters, ugly filenames) without slugs.
- `sidebars.js` uses **file paths**: `category/file-name`
- `ArticleList` and `FeaturedArticles` use **URL paths**: `category/slug`
- `<Link to={/${docId}}>` in components generates a URL path, so `docId` must be the actual built URL (e.g. `ai-native-pipeline/pipeline-design`), not a raw file name or slug alone.
- Docs without a category prefix use just the slug (e.g. `slug-value`).

## Adding New Categories

1. **Create the directory** `docs/<category-name>/` with a `_category_.json`:
   ```json
   {
     "label": "分类显示名称",
     "position": N,
     "link": {
       "type": "generated-index",
       "description": "分类描述"
     }
   }
   ```
2. **Add category to `sidebars.js`** as a new entry in the `aiSidebar` array:
   ```js
   {
     type: 'category',
     label: '🏷️ 分类显示名称',
     link: { type: 'generated-index', description: '分类描述' },
     items: ['category/article-1', 'category/article-2'],
   },
   ```
3. **Add category to `ArticleList/index.js`** in the `categories` array:
   ```js
   {
     label: '🏷️ 分类显示名称',
     description: '分类描述',
     items: [
       { docId: 'category/slug-1', title: '文章1', description: '...' },
     ],
   },
   ```
4. Run `npm run build` to verify.

## CI/CD

GitHub Actions workflow (`.github/workflows/deploy.yml`) auto-deploys to GitHub Pages on push to `master`. Uses Node 20 and `npm ci` for deterministic installs.
