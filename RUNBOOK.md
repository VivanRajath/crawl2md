# crawl2md Runbook

Reference for installing, running, and working with crawl2md.

---

## Prerequisites

- Node.js >= 18
- npm >= 9

---

## 1. Installing the Package

### Run without installing (npx)

```bash
npx crawl2md <url> [options]
```

### Install globally

```bash
npm install -g crawl2md
```

Then run from anywhere:

```bash
crawl2md <url> [options]
```

### Install locally in a project

```bash
npm install crawl2md
npx crawl2md <url> [options]
```

---

## 2. Developing Locally (contributors only)

Clone the repo, install dependencies, and run from source:

```bash
git clone https://github.com/VivanRajath/crawl2md
cd crawl2md
npm install
npm run dev -- <url> [options]
```

Build the compiled output:

```bash
npm run build
node dist/index.js <url> [options]
```

---

## 3. Modes of Operation

### Single-page fetch

Fetches one URL, extracts readable article content via Mozilla Readability, converts to Markdown, and writes a structured directory to `output/<hostname>/`.

```bash
npx crawl2md https://example.com
```

Output is written to `output/example.com/`.

### Full-site crawl

Crawls a site by following internal links from the seed URL up to a configurable depth. Writes a structured knowledge directory to `output/<hostname>/`.

```bash
npx crawl2md https://docs.example.com --crawl
```

The crawl runs as a BFS (breadth-first search). The seed URL is enqueued at depth 0. Each discovered internal link is enqueued at `parent depth + 1`. Pages at depth greater than `--depth` are not fetched.

---

## 4. Crawl Options

| Flag | Type | Default | Description |
|---|---|---|---|
| `--crawl` | boolean | off | Enable site-crawl mode. Without this, only the seed URL is fetched. |
| `--depth <n>` | integer | `3` | Maximum BFS depth from the seed URL. |
| `--max-pages <n>` | integer | `50` | Hard cap on total successfully crawled pages. Crawl stops when this is reached regardless of remaining queue. |
| `--include <path>` | string | none | Restrict crawl to URLs whose pathname starts with this prefix. Can be repeated. |
| `--exclude <path>` | string | none | Skip URLs whose pathname starts with this prefix. Can be repeated. |
| `--chunks` | boolean | off | After writing pages, split each page on `##` headings and write chunk files with YAML frontmatter. |

---

## 5. Crawl Examples

Crawl the entire site with defaults (depth 3, 50 pages):

```bash
npx crawl2md https://docs.example.com --crawl
```

Crawl only the `/docs` section, up to 200 pages:

```bash
npx crawl2md https://site.com --crawl --include /docs --max-pages 200
```

Crawl at depth 5, skip blog and changelog:

```bash
npx crawl2md https://site.com --crawl --depth 5 --exclude /blog --exclude /changelog
```

Crawl multiple path prefixes and exclude an internal sub-path:

```bash
npx crawl2md https://site.com --crawl --include /api --include /guides --exclude /api/internal
```

Crawl and produce RAG-ready chunk files:

```bash
npx crawl2md https://docs.example.com --crawl --chunks
```

Crawl with maximum coverage:

```bash
npx crawl2md https://docs.example.com --crawl --depth 10 --max-pages 500 --chunks
```

> Windows + Git Bash: Git Bash expands bare path arguments like `/docs` into absolute Windows paths like `C:/Program Files/Git/docs`. The tool normalizes these automatically. Pass paths as `/docs` regardless of shell.

---

## 6. URL Filtering Rules

These rules are applied automatically before any URL is enqueued. No configuration needed.

**Blocked by hostname:** Only URLs on the same hostname as the seed URL are followed.

**Blocked by protocol:** Only `http:` and `https:` URLs are crawled. `mailto:`, `javascript:`, and others are dropped.

**Blocked by fragment:** Fragment-only URLs (e.g. `#section`) are dropped.

**Blocked extensions:**

```
.pdf  .zip  .png  .jpg  .jpeg  .gif  .svg
.mp4  .mp3  .webp  .ico  .woff  .woff2  .ttf  .css  .js
```

**Blocked path segments:**

```
/login  /logout  /signup  /sign-up  /register
/auth  /oauth  /search  /cdn-cgi  /wp-admin
/wp-login  /cart  /checkout  /account  /profile
/feed  /rss  /sitemap
```

**Query strings:** Stripped from all URLs before deduplication. `https://site.com/page?utm_source=x` and `https://site.com/page` are the same URL.

**Trailing slashes:** Stripped before deduplication. `https://site.com/docs/` and `https://site.com/docs` are the same URL.

---

## 7. Output Structure

### Single-page mode

```
<filename>.md          # Markdown of the fetched page
```

### Crawl mode

```
output/
└── <hostname>/
    ├── index.md           # table: title, word count, reading time, depth, URL
    ├── sitemap.json       # page graph with slug to linked slugs
    ├── metadata.json      # crawl stats: duration, attempted, succeeded, skipped, failed URLs, options
    ├── pages/
    │   ├── getting-started.md
    │   ├── api-reference.md
    │   └── ...            # one .md per crawled page, with a Related Pages section at the bottom
    └── chunks/            # only written when --chunks is passed
        ├── getting-started/
        │   ├── chunk-001.md
        │   ├── chunk-002.md
        │   └── ...
        └── ...
```

#### index.md columns

| Column | Content |
|---|---|
| Page | Linked title pointing to the page file |
| Words | Word count of the Markdown content |
| Read | Estimated reading time in minutes (at 200 wpm) |
| Depth | BFS depth at which this page was reached |
| URL | Original source URL |

#### metadata.json fields

| Field | Description |
|---|---|
| `seedUrl` | Normalized starting URL |
| `crawledAt` | ISO 8601 timestamp when the crawl began |
| `durationMs` | Total wall-clock time for the crawl in milliseconds |
| `attempted` | Total fetch attempts (including failures) |
| `succeeded` | Pages successfully parsed and written |
| `skipped` | Attempts that failed fetch or parse |
| `totalWords` | Combined word count across all pages |
| `avgWordsPerPage` | Mean word count |
| `maxDepthReached` | Deepest BFS level of any successfully crawled page |
| `totalChunks` | Total chunk files written (0 if `--chunks` not passed) |
| `failedUrls` | List of URLs that failed to fetch or parse |
| `options` | The resolved crawl options used for this run |

#### Chunk frontmatter

```yaml
---
source: "https://docs.example.com/getting-started"
title: "Getting Started"
page: "pages/getting-started.md"
chunk: 1
total: 4
section: "Installation"
---
```

The `section` field is omitted if the chunk has no `##` heading (introductory content before the first heading).

---

## 8. Slug Generation and Collision Handling

Filenames are derived from the URL pathname. The pathname is lowercased, leading and trailing slashes are stripped, path separators are replaced with dashes, and all non-word characters are replaced with dashes. Consecutive dashes are collapsed. The root path `/` produces the slug `index`.

If two URLs produce the same base slug, a numeric suffix is appended: `slug`, `slug-2`, `slug-3`, and so on.

---

## 9. Command Reference

### Using the published package

| Command | Description |
|---|---|
| `npx crawl2md <url>` | Run without installing (always uses latest version) |
| `npm install -g crawl2md` | Install globally |
| `crawl2md <url>` | Run after global install |

### For contributors (local development)

| Command | Description |
|---|---|
| `npm install` | Install all dependencies |
| `npm run dev -- <args>` | Run via `tsx` with no build step |
| `npm run build` | Compile TypeScript to `dist/` |
| `node dist/index.js <args>` | Run compiled output directly |

---

## 10. Source Layout

```
src/
├── index.ts                   Entry point, calls runCLI()
├── cli/
│   └── cli.ts                 Commander argument parsing, routes to crawl or single-page
├── crawler/
│   ├── SiteCrawler.ts         BFS crawl loop, orchestrates all sub-modules, writes output
│   ├── CrawlQueue.ts          FIFO queue with a seen-set for deduplication
│   ├── PageRegistry.ts        In-memory store of PageRecord objects, slug uniqueness enforcement
│   └── UrlFilter.ts           Allow/deny rules, URL normalization, Git Bash path handling
├── parser/
│   ├── readability.ts         Mozilla Readability wrapper, extracts article title and HTML content
│   ├── htmlParser.ts          Cheerio-based link extraction helpers
│   └── markdown.ts            Turndown HTML-to-Markdown converter
├── exporters/
│   ├── markdownExport.ts      Writes a single .md file to disk
│   ├── jsonExport.ts          Writes a single .json file to disk
│   ├── pageWriter.ts          Writes all crawled pages with a Related Pages section
│   ├── siteIndexWriter.ts     Writes index.md, sitemap.json, metadata.json
│   └── chunkWriter.ts         Splits pages by ## headings, writes chunk files with frontmatter
└── utils/
    ├── fetch.ts               Axios HTTP wrapper with User-Agent header
    ├── slugify.ts             URL to safe filename slug with collision suffix logic
    └── url.ts                 URL to default output filename for single-page mode
```

---

## 11. Known Behaviors

- Pages that return HTTP errors or that Readability cannot parse are skipped and logged. Their URLs appear in `metadata.json` under `failedUrls`.
- Pages with no extractable content (empty Readability result) are silently skipped and do not appear in `failedUrls`.
- The crawl is sequential with no concurrent fetching. This keeps things simple and avoids rate-limit bans on most documentation hosts.
- Only `##`-level headings trigger chunk boundaries. `###` and deeper headings stay inside the chunk of the `##` section they belong to.
- The `output/` directory is created relative to the current working directory.
