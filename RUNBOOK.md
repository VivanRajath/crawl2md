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

Crawls a site by following internal links from the seed URL up to a configurable depth.

```bash
npx crawl2md https://docs.example.com --crawl
```

The crawl runs BFS (breadth-first). The seed URL is enqueued at depth 0. Each discovered internal link is enqueued at `parent depth + 1`. Pages beyond `--depth` are not fetched.

---

## 4. Crawl Options

| Flag | Type | Default | Description |
|---|---|---|---|
| `--crawl` | boolean | off | Enable site-crawl mode. Without this, only the seed URL is fetched. |
| `--depth <n>` | integer | `3` | Maximum BFS depth from the seed URL. |
| `--max-pages <n>` | integer | `50` | Hard cap on total successfully crawled pages. |
| `--include <path>` | string | none | Restrict crawl to URLs whose pathname starts with this prefix. Can be repeated. |
| `--exclude <path>` | string | none | Skip URLs whose pathname starts with this prefix. Can be repeated. |
| `--output <dir>` | string | `output/<hostname>` | Write output to this directory instead of the default. |

---

## 5. Chunking Options

Chunking splits each page into smaller pieces for RAG ingestion. Requires `--chunks`.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--chunks` | boolean | off | Enable chunk output under `chunks/`. |
| `--chunk-size <n>` | integer | `512` | Max tokens per chunk (1 token ≈ 4 chars). |
| `--chunk-overlap <n>` | integer | `50` | Overlap tokens carried from the previous chunk into the next. |
| `--chunk-strategy <s>` | string | `heading` | Strategy: `heading`, `paragraph`, or `token`. |

**Strategies:**

- `heading`: split on `##` boundaries. Oversized heading sections are sub-split on paragraphs. Best for well-structured docs.
- `paragraph`: split on blank-line boundaries and group until the size limit is reached. Good for sites with poor heading structure.
- `token`: fixed-size sliding window, ignores document structure. Guaranteed uniform chunk sizes.

---

## 6. Embedding Export

Generates a single file containing all chunks with metadata, ready to upsert into a vector database after you add embedding vectors.

```bash
npx crawl2md https://docs.example.com --crawl --embeddings
npx crawl2md https://docs.example.com --crawl --embeddings --embeddings-format pinecone
```

| Flag | Type | Default | Description |
|---|---|---|---|
| `--embeddings` | boolean | off | Write embedding export file. |
| `--embeddings-format <fmt>` | string | `generic` | Output format: `generic`, `pinecone`, `chroma`, `qdrant`, `weaviate`. |

Output files:

| Format | File | Shape |
|---|---|---|
| `generic` | `embeddings.jsonl` | `{ id, text, metadata }` per line |
| `pinecone` | `embeddings.jsonl` | `{ id, metadata: { text, ... } }` per line |
| `chroma` | `embeddings.json` | `{ ids, documents, metadatas }` arrays |
| `qdrant` | `embeddings.json` | `{ points: [{ id, payload }] }` |
| `weaviate` | `embeddings.jsonl` | `{ class: "Chunk", properties }` per line |

No embedding API calls are made. The text field is what you pass to your embedding model.

---

## 7. Agent Export Mode

Produces structured JSON per page plus a knowledge graph, designed to be consumed directly by AI agents.

```bash
npx crawl2md https://docs.example.com --crawl --format agent
```

Output goes to `agent/` inside the output directory.

**Per-page file (`agent/<slug>.json`):**

```json
{
  "url": "https://...",
  "title": "Getting Started",
  "summary": "First paragraph of page content.",
  "concepts": ["authentication", "api key"],
  "apis": [{ "method": "GET", "path": "/api/v1/users" }],
  "codeLanguages": ["bash", "python"],
  "externalLinks": ["https://stripe.com/docs"],
  "internalLinks": ["pages/api-reference.md"],
  "entities": {
    "packages": ["axios", "express"],
    "envVars": ["API_KEY", "DATABASE_URL"]
  }
}
```

**`agent/knowledge-graph.json`:** array of all pages with their concepts and internal link targets. An agent can traverse this to find relevant pages without reading every file.

All extraction is heuristic (regex-based). No LLM calls are made.

---

## 8. Incremental Crawling

Only re-crawl pages that changed since the last run. Useful for large sites, CI pipelines, and keeping a knowledge base in sync.

```bash
npx crawl2md https://docs.example.com --crawl --update
```

How it works:

1. On first run, a `.crawl-cache.json` file is written to the output directory with a content hash, ETag, and metadata for every crawled page.
2. On subsequent `--update` runs, each URL is fetched with `If-None-Match` / `If-Modified-Since` headers. A `304 Not Modified` response means the page is skipped immediately.
3. If the server ignores conditional headers, the response body is hashed and compared to the stored hash. Same hash means the page is skipped.
4. Skipped pages are restored from cache into the registry so `index.md` and `sitemap.json` still reflect the full site.
5. The cache is rewritten at the end of every run.

---

## 9. Crawl Examples

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

Crawl with paragraph chunking (good for poorly structured sites):

```bash
npx crawl2md https://site.com --crawl --chunks --chunk-strategy paragraph --chunk-size 400
```

Crawl with token chunking and overlap for dense technical docs:

```bash
npx crawl2md https://site.com --crawl --chunks --chunk-strategy token --chunk-size 512 --chunk-overlap 100
```

Full pipeline: crawl, chunk, embeddings, agent export, incremental on next run:

```bash
# First run
npx crawl2md https://docs.example.com --crawl --chunks --embeddings --format agent --output ./kb

# Subsequent runs (only changed pages)
npx crawl2md https://docs.example.com --crawl --chunks --embeddings --format agent --output ./kb --update
```

> Windows + Git Bash: Git Bash expands bare path arguments like `/docs` into absolute Windows paths. The tool normalizes these automatically. Pass paths as `/docs` regardless of shell.

---

## 10. URL Filtering Rules

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

**Query strings:** Stripped before deduplication. `https://site.com/page?utm_source=x` and `https://site.com/page` are the same URL.

**Trailing slashes:** Stripped before deduplication.

---

## 11. Output Structure

### Single-page mode

```
<filename>.md          # Markdown of the fetched page
```

### Crawl mode

```
output/
└── <hostname>/
    ├── index.md              # table: title, word count, reading time, depth, URL
    ├── sitemap.json          # page graph with slug to linked slugs
    ├── metadata.json         # full crawl stats including options used
    ├── embeddings.jsonl      # present when --embeddings is passed
    ├── .crawl-cache.json     # present when --update has been used
    ├── pages/
    │   └── ...               # one .md per crawled page, with Related Pages section
    ├── chunks/               # present when --chunks is passed
    │   └── <slug>/
    │       └── chunk-NNN.md
    └── agent/                # present when --format agent is passed
        ├── <slug>.json
        └── knowledge-graph.json
```

#### metadata.json fields

| Field | Description |
|---|---|
| `seedUrl` | Normalized starting URL |
| `crawledAt` | ISO 8601 timestamp when the crawl began |
| `durationMs` | Total wall-clock time in milliseconds |
| `attempted` | Total URLs dequeued for processing |
| `succeeded` | Pages fully fetched, parsed, and written |
| `cachedPages` | Pages skipped because content was unchanged (incremental mode) |
| `skipped` | Pages that failed to fetch or parse |
| `totalWords` | Combined word count across all pages |
| `avgWordsPerPage` | Mean word count |
| `maxDepthReached` | Deepest BFS level reached |
| `totalChunks` | Total chunk files written |
| `embeddingRecords` | Total embedding records written |
| `failedUrls` | List of URLs that failed to fetch or parse |
| `options` | The full set of options used for this run |

---

## 12. Command Reference

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

## 13. Source Layout

```
src/
├── index.ts                    Entry point, calls runCLI()
├── cli/
│   └── cli.ts                  Commander argument parsing, routes to crawl or single-page
├── crawler/
│   ├── SiteCrawler.ts          BFS crawl loop, orchestrates all sub-modules, writes output
│   ├── CrawlQueue.ts           FIFO queue with a seen-set for deduplication
│   ├── PageRegistry.ts         In-memory store of PageRecord objects, slug uniqueness enforcement
│   ├── UrlFilter.ts            Allow/deny rules, URL normalization, Git Bash path handling
│   └── CrawlCache.ts           Content hash cache for incremental crawl mode
├── parser/
│   ├── readability.ts          Mozilla Readability wrapper, extracts article title and HTML content
│   ├── htmlParser.ts           Cheerio-based link extraction helpers
│   ├── markdown.ts             Turndown HTML-to-Markdown converter
│   └── extractors.ts           Heuristic extractors: summary, concepts, APIs, packages, env vars
├── exporters/
│   ├── markdownExport.ts       Writes a single .md file to disk
│   ├── jsonExport.ts           Writes a single .json file to disk
│   ├── pageWriter.ts           Writes all crawled pages with a Related Pages section
│   ├── chunkWriter.ts          Splits pages by strategy, writes chunk files with frontmatter
│   ├── embeddingWriter.ts      Writes embedding-ready JSONL/JSON for vector databases
│   ├── agentWriter.ts          Writes per-page agent JSON and knowledge-graph.json
│   └── siteIndexWriter.ts      Writes index.md, sitemap.json, metadata.json
└── utils/
    ├── fetch.ts                Axios HTTP wrapper with User-Agent header
    ├── slugify.ts              URL to safe filename slug with collision suffix logic
    └── url.ts                  URL to default output filename for single-page mode
```

---

## 14. Known Behaviors

- Pages that return HTTP errors or that Readability cannot parse are skipped and logged under `failedUrls` in `metadata.json`.
- Pages with no extractable content (empty Readability result) are silently skipped.
- The crawl is sequential with no concurrent fetching. This keeps things simple and avoids rate-limit bans on most documentation hosts.
- Only `##`-level headings trigger chunk boundaries in `heading` strategy. `###` and deeper stay inside the parent section.
- In `--update` mode, embedding and agent exports only include new or changed pages (cached pages have no markdown content in memory). Run without `--update` periodically to regenerate complete embedding/agent exports.
- The `output/` directory is created relative to the current working directory unless `--output` is specified.
