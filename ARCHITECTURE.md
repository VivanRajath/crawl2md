# crawl2md Architecture

A walkthrough of the design, data flow, and module responsibilities in the crawl2md codebase.

**npm package:** `crawl2md` - install with `npm install -g crawl2md` or run with `npx crawl2md <url>`.

---

## Purpose and Design Philosophy

The typical AI agent research loop: receive URL, fetch page, strip HTML, extract text, reason over content. All of that happens inside the context window and burns tokens. For a single page it's fine. For a documentation site with 50-100 pages, the fetch-parse overhead takes over and leaves little room for actual reasoning.

crawl2md moves that pipeline to the local filesystem. One CLI call fetches, parses, deduplicates, and converts an entire site into plain Markdown files. The agent reads local files with no HTTP requests, no HTML parsing, and no wasted tokens on nav menus or footers.

Beyond plain Markdown, crawl2md produces three additional output types depending on the flags you pass:
- **Chunks** (`--chunks`): token-aware split files with YAML frontmatter, ready for vector store ingestion
- **Embeddings** (`--embeddings`): a single JSONL/JSON export formatted for Pinecone, Chroma, Qdrant, Weaviate, or generic use
- **Agent export** (`--format agent`): per-page structured JSON with summaries, concepts, APIs, packages, and a knowledge graph

The code is split into four independent layers: crawling, parsing, exporting, and utilities. Each layer communicates through a typed in-memory registry. No layer knows about the others' internals.

---

## High-Level Data Flow

```
CLI arguments
     |
     v
  runCLI()  [cli/cli.ts]
     |
     v
  runSiteCrawler()  [crawler/SiteCrawler.ts]
     |
     +---> UrlFilter       initialized with seed URL, include/exclude rules
     +---> CrawlQueue      seed URL enqueued at depth 0
     +---> CrawlCache      loaded from disk if --update is set
     |
     +--- BFS loop ---+
     |                |
     |         fetchPage()        axios GET with conditional headers -> FetchResult
     |                |
     |         [if unchanged]     restore from CrawlCache, skip processing
     |                |
     |         extractReadableContent()   JSDOM + Readability -> { title, content (HTML) }
     |                |
     |         extractLinks()     Cheerio -> resolved absolute URLs
     |                |
     |         htmlToMarkdown()   Turndown -> Markdown string
     |                |
     |         registry.register()    slug generation, store PageRecord
     |                |
     |         crawlCache.set()   update hash + metadata for this page
     |                |
     |         enqueue outbound URLs (filtered, not already seen)
     |
     v
  writePages()          [exporters/pageWriter.ts]
     v
  writeChunks()         [exporters/chunkWriter.ts]       (if --chunks)
     v
  writeEmbeddings()     [exporters/embeddingWriter.ts]   (if --embeddings)
     v
  writeAgentExport()    [exporters/agentWriter.ts]       (if --format agent)
     v
  writeSiteIndex()      [exporters/siteIndexWriter.ts]
     v
  crawlCache.save()     [crawler/CrawlCache.ts]          (if --update)
```

---

## Module Breakdown

### Entry Point (`src/index.ts`)

Minimal. Imports `runCLI` from `cli/cli.ts` and calls it.

---

### CLI Layer (`src/cli/cli.ts`)

Built on [Commander](https://github.com/tj/commander.js). Defines the public interface of the tool.

Single-page and crawl modes use the same code path. Single-page mode passes `maxDepth: 0` and `maxPages: 1`, so the BFS loop runs once and stops.

```typescript
maxDepth: options.crawl ? parseInt(options.depth) : 0,
maxPages: options.crawl ? parseInt(options.maxPages) : 1,
```

All new flags (`--chunk-size`, `--embeddings-format`, `--update`, `--format`, `--output`) are parsed here and forwarded through `CrawlOptions` to `runSiteCrawler`.

---

### Crawler (`src/crawler/SiteCrawler.ts`)

The main orchestrator. Owns the BFS crawl loop and coordinates all other modules.

**CrawlOptions** includes:

```typescript
{
  maxDepth, maxPages, include, exclude,
  chunks, chunkSize, chunkOverlap, chunkStrategy,
  embeddings, embeddingsFormat,
  update,
  format,
  outputDir,
}
```

**CrawlStats** includes all the above options plus runtime telemetry:

```typescript
{
  seedUrl, crawledAt, durationMs,
  attempted, succeeded, cachedPages, skipped,
  totalWords, avgWordsPerPage, maxDepthReached,
  totalChunks, embeddingRecords,
  failedUrls, options
}
```

**fetchPage() vs the old fetchHTML():**

The original `fetchHTML` was a simple axios GET that threw on failure. It has been replaced with `fetchPage()`, which:
- Adds `If-None-Match` and `If-Modified-Since` headers when a cache entry exists
- Accepts `304 Not Modified` responses without throwing (via `validateStatus`)
- Compares content hashes when the server doesn't support conditional requests
- Returns a `FetchResult` with the html, response headers, and an `unchanged` flag

This handles the incremental crawl case without branching the BFS loop into two separate paths.

**BFS loop with incremental support:**

When `--update` is set and `fetchResult.unchanged` is true, the page is restored from cache via `registry.registerCached()` and its outbound URLs (from cache) are re-enqueued. File writes are skipped because `markdownContent` is empty in the restored record. The BFS still discovers all linked pages this way, so `index.md` and `sitemap.json` remain complete across update runs.

---

### Crawl Cache (`src/crawler/CrawlCache.ts`)

Manages the `.crawl-cache.json` file in the output directory.

**CacheEntry shape:**

```typescript
{
  hash: string;         // SHA-256 of the raw HTML
  crawledAt: string;    // ISO timestamp
  etag?: string;        // from response headers
  lastModified?: string;
  title: string;
  slug: string;
  wordCount: number;
  outboundUrls: string[];
}
```

`CrawlCache.hash(html)` is a static method so `SiteCrawler` can call it without holding a cache instance.

`isUnchanged(url, html)` computes the hash of the new HTML and compares it to the stored entry. Used as a fallback when the server doesn't return a `304`.

---

### Crawl Queue (`src/crawler/CrawlQueue.ts`)

A FIFO queue backed by an array plus a `Set<string>` for seen-URL deduplication.

`enqueue(url, depth)`: adds an entry only if the URL has not been seen before. The seen-set is updated on enqueue, not on dequeue.

BFS order ensures every page is reached at the minimum possible depth, which gives accurate depth values in `index.md` and `metadata.json`.

---

### Page Registry (`src/crawler/PageRegistry.ts`)

An in-memory store of all successfully crawled pages, keyed by URL.

**PageRecord shape:**

```typescript
{
  url: string;
  slug: string;
  filename: string;
  title: string;
  depth: number;
  outboundUrls: string[];
  markdownContent: string;  // empty string for cached (unchanged) pages
  wordCount: number;
}
```

**`register()`**: computes slug, wordCount, and stores the full record.

**`registerCached()`**: adds a record with empty `markdownContent` from cache metadata. Used in `--update` mode. Writers check `if (!page.markdownContent) continue` to skip re-writing files that already exist on disk.

---

### URL Filter (`src/crawler/UrlFilter.ts`)

Stateless filter for deciding which URLs the crawler follows.

**`allow(url)`** checks in order:
1. URL parses without error
2. Hostname matches seed (same-domain only)
3. Protocol is `http:` or `https:`
4. No hash fragment
5. Extension not in `BLOCKED_EXTENSIONS`
6. Pathname not in `BLOCKED_PATH_SEGMENTS`
7. If `--include` specified, pathname starts with at least one prefix
8. Pathname does not start with any `--exclude` prefix

Rules short-circuit. A URL failing rule 2 never reaches rule 7.

**Git Bash path normalization:** On Windows, Git Bash expands `/docs` into `C:/Program Files/Git/docs`. `normalizePathPrefix()` detects this by matching known Git/MSYS/Cygwin/MinGW root directories and recovers the original path suffix.

---

### Parser Layer

**`parser/readability.ts`**: Wraps `jsdom` and `@mozilla/readability`. Returns `{ title, content }` where `content` is an HTML string of the article body.

**`parser/htmlParser.ts`**: Cheerio-based link extraction. Runs on raw HTML (not Readability output) because Readability strips navigation that may contain internal links.

**`parser/markdown.ts`**: Wraps Turndown. Converts HTML to Markdown.

**`parser/extractors.ts`**: Heuristic extraction functions for agent export mode. All regex-based, no LLM calls.

- `extractSummary`: first non-heading paragraph, up to 500 chars
- `extractConcepts`: H1–H3 headings + backtick-wrapped terms + bold/italic terms + top-15 high-frequency non-stopword terms; cap raised to 30
- `extractAPIs`: HTTP method + path patterns from prose (`GET /path`), Python decorators (`@app.get("/path")`), `@app.route(...)` with `methods=[]`, Express/Fastify `app.get(...)`, and OpenAPI YAML path keys
- `extractCodeLanguages`: fenced code block language tags
- `extractPackages`: npm `import`/`require`, pip `install`, cargo `add` patterns
- `extractEnvVars`: `ALL_CAPS_WORDS` found inside code blocks only (reduces false positives)
- `extractNamedEntities` *(new)*: pulls named entities from backtick-wrapped terms, bold terms, PascalCase words in prose, and terms following introduction phrases (`such as`, `built on`, `powered by`, etc.). Returns up to 25 deduplicated entities ranked by frequency.
- `extractRelationships` *(new)*: matches 12 semantic predicate patterns (`built-on`, `uses`, `wraps`, `extends`, `integrates-with`, `provides`, `requires`, `supports`, `implements`, `depends-on`, `compatible-with`) and adds co-occurrence `related-to` edges for entities sharing an H2 section. Only emits relationships where at least one side is a known entity from `extractNamedEntities`.

---

### Exporter Layer

**`exporters/pageWriter.ts`**: Writes one `.md` file per `PageRecord`. Skips records with empty `markdownContent` (cached pages in `--update` mode). Appends a `## Related Pages` section using `outboundUrls` resolved through the registry.

**`exporters/chunkWriter.ts`**: Splits Markdown into chunks and writes one file per chunk with YAML frontmatter. Skips empty `markdownContent`. Exports `splitIntoChunks()`, `ChunkOptions`, and `ChunkStrategy` for use by `embeddingWriter`.

Three strategies:
- `heading`: split on `##`. Sub-splits on paragraphs if a section exceeds `maxTokens`.
- `paragraph`: group paragraphs until `maxTokens` is reached.
- `token`: fixed-size sliding window of `maxTokens` chars (tokens approximated as `chars / 4`).

Overlap is applied as a post-processing step: the last `overlapTokens * 4` chars of chunk N are prepended to chunk N+1.

**`exporters/embeddingWriter.ts`**: Generates a single export file containing one record per chunk. Imports `splitIntoChunks` from `chunkWriter` so it works independently of `--chunks`. Supports five output formats.

Chunk ID format: `<hostname>/<slug>/chunk-NNN`

**`exporters/agentWriter.ts`**: Runs all extractors on each page and writes `agent/<slug>.json` plus `agent/knowledge-graph.json`. Only processes pages with non-empty `markdownContent`. Each page JSON now includes `entities.named` (named entities) and `relationships` (semantic triples). The knowledge graph nodes carry `entities`, `apis`, and `relationships` in addition to `concepts` and `linksTo`, giving an LLM full structured context per node without reading individual page files.

**`exporters/siteIndexWriter.ts`**: Writes `index.md` (Markdown table), `sitemap.json` (page graph), and `metadata.json` (full `CrawlStats`). Includes all registry entries regardless of whether they came from cache.

---

## Data Lifecycle Summary

```
URL string
  -> UrlFilter.normalize()         canonical URL
  -> CrawlQueue.enqueue()          FIFO queue entry at a given depth
  -> fetchPage()                   raw HTML + conditional-request result
  -> [if unchanged] CrawlCache     restore PageRecord, skip processing
  -> extractReadableContent()      { title, content (HTML) }
  -> htmlToMarkdown()              Markdown string
  -> PageRegistry.register()       PageRecord
  -> CrawlCache.set()              update hash + metadata
  -> writePages()                  pages/<slug>.md
  -> writeChunks()                 chunks/<slug>/chunk-NNN.md
  -> writeEmbeddings()             embeddings.jsonl / embeddings.json
  -> writeAgentExport()            agent/<slug>.json + knowledge-graph.json
  -> writeSiteIndex()              index.md, sitemap.json, metadata.json
  -> CrawlCache.save()             .crawl-cache.json
```

---

## Architectural Constraints and Trade-offs

**Sequential crawling**

The BFS loop is sequential, one page at a time. Concurrent fetching would be faster but risks rate limits and adds complexity around shared queue/registry state. For a tool you run once to build a local knowledge base, sequential is fine. `--update` significantly reduces crawl time on repeat runs.

**In-memory registry**

All `PageRecord` objects are held in memory. Works fine for documentation sites in the tens-to-low-hundreds of pages. A disk-backed registry would be the next step for very large crawls.

**Token approximation**

Chunk sizes are estimated as `chars / 4`. This is accurate enough for English prose (roughly matches GPT token counts) without requiring a tokenizer dependency. Dense code or non-Latin scripts will have different ratios.

**Embedding and agent exports skip cached pages in --update mode**

When `--update` is used, cached (unchanged) pages have empty `markdownContent` in memory. The embedding and agent writers skip these pages. This means incremental runs produce partial embedding/agent exports. Run without `--update` periodically to regenerate complete exports if you need full coverage.

**Heuristic agent extraction**

All agent export fields (summary, concepts, APIs, named entities, relationships, packages, env vars) are extracted with regex patterns and frequency analysis. No LLM calls are made. Extraction quality scales with document structure: it works well on technical documentation that uses markdown formatting (backticks, bold, headings) and poorly on unstructured prose or JavaScript-heavy SPAs that produce flat text after Readability.

**No JavaScript rendering**

Axios fetches raw server-rendered HTML. Pages requiring JavaScript to render will return empty content. For JS-rendered sites, use a pre-rendered or SSR URL.

**Chunk boundary at `##` only (heading strategy)**

Second-level headings are the split point. `###` and deeper stay inside the parent section. Use `paragraph` or `token` strategy for sites with poor heading structure.

---

## Output as a Knowledge Base

The `output/<hostname>/` directory is self-contained:

- `index.md`: what pages exist, navigable by title
- `sitemap.json`: the page graph, traversable without reading individual files
- `metadata.json`: provenance, coverage, and all options used
- `pages/*.md`: clean documents with relative links to related pages
- `chunks/<slug>/chunk-NNN.md`: RAG-ready embedding units with all metadata in frontmatter
- `embeddings.jsonl`: pre-formatted for direct vector database ingestion
- `agent/<slug>.json`: structured knowledge per page — summary, concepts, named entities, relationships, APIs, packages, env vars
- `agent/knowledge-graph.json`: rich page graph with concepts, entities, APIs, relationships, and link targets per node
