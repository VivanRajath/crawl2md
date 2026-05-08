# crawl2md Architecture

A walkthrough of the design, data flow, and module responsibilities in the crawl2md codebase.

**npm package:** `crawl2md` - install with `npm install -g crawl2md` or run with `npx crawl2md <url>`.

---

## Purpose and Design Philosophy

The typical AI agent research loop: receive URL, fetch page, strip HTML, extract text, reason over content. All of that happens inside the context window and burns tokens. For a single page it's fine. For a documentation site with 50-100 pages, the fetch-parse overhead takes over and leaves little room for actual reasoning.

crawl2md moves that pipeline to the local filesystem. One CLI call fetches, parses, deduplicates, and converts an entire site into plain Markdown files. The agent reads local files with no HTTP requests, no HTML parsing, and no wasted tokens on nav menus or footers. The chunk output is structured for direct RAG ingestion without any additional pre-processing.

The code is split into three independent layers: crawling, parsing, and exporting. Each layer communicates through a typed in-memory registry. No layer knows about the others' internals.

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
     |
     +---> CrawlQueue      seed URL enqueued at depth 0
     |
     +--- BFS loop ---+
     |                |
     |         fetchHTML()       axios GET -> raw HTML string
     |                |
     |         extractReadableContent()   JSDOM + Readability -> { title, content (HTML) }
     |                |
     |         extractLinks()    Cheerio -> all href values -> resolved absolute URLs
     |                |
     |         htmlToMarkdown()  Turndown -> Markdown string
     |                |
     |         registry.register()  slug generation, store PageRecord
     |                |
     |         enqueue outbound URLs (filtered, not already seen)
     |
     v
  writePages()         [exporters/pageWriter.ts]
     |                  writes pages/ directory
     v
  writeChunks()        [exporters/chunkWriter.ts]  (optional)
     |                  writes chunks/ directory
     v
  writeSiteIndex()     [exporters/siteIndexWriter.ts]
                        writes index.md, sitemap.json, metadata.json
```

---

## Module Breakdown

### Entry Point (`src/index.ts`)

Minimal. Imports `runCLI` from `cli/cli.ts` and calls it. All logic is delegated.

---

### CLI Layer (`src/cli/cli.ts`)

Built on [Commander](https://github.com/tj/commander.js). Defines the public interface of the tool.

Responsibilities:
- Declare the command name, description, positional `<url>` argument, and all option flags
- Collect repeatable `--include` and `--exclude` values into arrays using a reducer
- Map CLI option values to a typed `CrawlOptions` object
- Route execution to `runSiteCrawler()`

Single-page and crawl modes use the same code path. Single-page mode passes `maxDepth: 0` and `maxPages: 1`, so the BFS loop runs once and stops.

```typescript
maxDepth: options.crawl ? parseInt(options.depth) : 0,
maxPages: options.crawl ? parseInt(options.maxPages) : 1,
```

---

### Crawler (`src/crawler/SiteCrawler.ts`)

The main orchestrator. Owns the BFS crawl loop and coordinates everything else.

**Exported types:**

`CrawlOptions`: input configuration

```typescript
{
  maxDepth: number;
  maxPages: number;
  include?: string[];
  exclude?: string[];
  chunks?: boolean;
}
```

`CrawlStats`: output telemetry written to `metadata.json`

```typescript
{
  seedUrl, crawledAt, durationMs,
  attempted, succeeded, skipped,
  totalWords, avgWordsPerPage, maxDepthReached,
  totalChunks, options, failedUrls
}
```

`CrawlResult`: return value of `runSiteCrawler()`

```typescript
{ registry: PageRegistry, hostname: string, stats: CrawlStats }
```

**BFS loop walkthrough:**

1. `UrlFilter` and `CrawlQueue` are initialized. The normalized seed URL is enqueued at depth 0.
2. While the queue is not empty and the page cap has not been reached:
   a. Dequeue the next entry. Skip if its depth exceeds `maxDepth`.
   b. `fetchHTML()`: axios GET with a 10 second timeout. On failure, log the URL to `failedUrls` and continue.
   c. `extractReadableContent()`: JSDOM + Mozilla Readability. On failure, log and continue. If Readability returns no content, skip silently.
   d. `extractLinks()`: Cheerio parses the raw HTML and resolves all `href` values to absolute URLs.
   e. Each outbound URL is normalized by `UrlFilter.normalize()`, then tested by `UrlFilter.allow()`. Only those that pass are kept.
   f. `htmlToMarkdown()` converts the Readability HTML output to Markdown.
   g. `registry.register()` generates a unique slug and stores a `PageRecord`.
   h. If the current depth is less than `maxDepth`, allowed outbound URLs not already seen are enqueued at `depth + 1`.
3. After the loop, `writePages()`, optionally `writeChunks()`, and `writeSiteIndex()` are called in order.

**Why Readability and not raw Cheerio?**

Readability was built by Mozilla for Firefox Reader View. It identifies the main content block and strips nav, ads, sidebars, and footers. Raw Cheerio would need per-site CSS selector rules. Readability works across sites without configuration.

**Why link extraction uses raw HTML and not Readability output?**

Readability strips navigation and structural elements to isolate article content. Those stripped elements often contain the internal links needed to continue crawling. So link extraction runs on the original raw HTML.

---

### Crawl Queue (`src/crawler/CrawlQueue.ts`)

A FIFO queue backed by an array plus a `Set<string>` for seen-URL deduplication.

`enqueue(url, depth)`: adds an entry only if the URL has not been seen before. The seen-set is updated on enqueue, not on dequeue, so a URL that appears in multiple pages' outbound links is only queued once.

`next()`: shifts from the front of the array (FIFO = breadth-first order).

`hasSeen(url)`: external check used by `SiteCrawler` before calling `enqueue`, so it can also skip URLs already in the `PageRegistry`.

BFS order matters here: it ensures every page is reached at the minimum possible depth, which gives accurate depth values in `index.md` and `metadata.json`.

---

### Page Registry (`src/crawler/PageRegistry.ts`)

An in-memory store of all successfully crawled pages, keyed by URL.

**PageRecord shape:**

```typescript
{
  url: string;          // original URL
  slug: string;         // derived filename slug (collision-safe)
  filename: string;     // slug + ".md"
  title: string;        // from Readability
  depth: number;        // BFS depth
  outboundUrls: string[]; // filtered outbound links
  markdownContent: string;
  wordCount: number;    // word count of markdownContent
}
```

**Slug generation:**

`urlToSlug()` in `utils/slugify.ts` transforms the URL pathname:

1. Strip trailing slashes
2. Strip leading slashes
3. Replace `/` path separators with `-`
4. Replace non-word characters with `-`
5. Collapse consecutive dashes
6. Lowercase

The root path `/` becomes `index`.

`makeUniqueSlug()` appends a numeric counter (`-2`, `-3`, ...) if the base slug is already taken. Two different URLs that produce the same slug will never overwrite each other's files.

---

### URL Filter (`src/crawler/UrlFilter.ts`)

Stateless filter for deciding which URLs the crawler follows.

**`allow(url)`** applies rules in this order:

1. URL must parse without error
2. Hostname must match the seed hostname (same-domain only)
3. Protocol must be `http:` or `https:`
4. URL must not have a hash fragment (fragments point to anchors on already-crawled pages)
5. File extension must not be in `BLOCKED_EXTENSIONS`
6. Pathname must not contain any string in `BLOCKED_PATH_SEGMENTS`
7. If `--include` prefixes were specified, the pathname must start with at least one of them
8. Pathname must not start with any `--exclude` prefix

Rules short-circuit. A URL that fails rule 2 never reaches rule 7.

**`normalize(url)`** strips the hash, query string, and trailing slashes (except for the root `/`). This canonical form is stored in the queue and registry, so `https://site.com/page?ref=nav` and `https://site.com/page` are treated as the same URL.

**Git Bash path normalization:**

On Windows, Git Bash expands bare POSIX paths passed as arguments. `/docs` becomes `C:/Program Files/Git/docs` before the process receives it. `normalizePathPrefix()` detects this by looking for known Git/MSYS/Cygwin/MinGW root directory names and recovers the original path suffix. For generic Windows absolute paths without those markers, it strips the drive letter and first directory.

---

### Parser Layer

Three focused modules, each with a single responsibility.

**`parser/readability.ts`**

Wraps `jsdom` and `@mozilla/readability`. Creates a JSDOM virtual DOM from the raw HTML string (with the page URL as the base so relative resources resolve correctly), runs Readability's `parse()`, and returns `{ title, content }` where `content` is an HTML string of the main article body. Returns `{ title: "Untitled", content: "" }` on failure.

**`parser/htmlParser.ts`**

Cheerio-based helpers for extracting data from raw HTML. Used for link extraction in `SiteCrawler.ts` via `extractLinks()`, which selects all `a[href]` elements and resolves each href to an absolute URL using the native `URL` constructor.

**`parser/markdown.ts`**

Wraps [Turndown](https://github.com/mixmark-io/turndown). Converts HTML to Markdown. Turndown handles headings, paragraphs, lists, code blocks, tables, links, and images.

---

### Exporter Layer

Four exporters, each writing one type of output artifact.

**`exporters/pageWriter.ts`**

Writes one `.md` file per `PageRecord` to `output/<hostname>/pages/`.

Each file follows this structure:

```
# <title>

<markdownContent>

## Related Pages

- [Title A](./slug-a.md)
- [Title B](./slug-b.md)
```

The Related Pages section is built by looking up each URL in `page.outboundUrls` against the `PageRegistry`. Only URLs that were successfully crawled get entries. Links are relative paths within `pages/`, so the knowledge base works offline.

**`exporters/chunkWriter.ts`**

Splits each page's Markdown on `##` heading boundaries and writes one file per chunk.

`splitIntoChunks()` processes the Markdown line by line. When it hits a `## ` line, it flushes the current accumulated lines as a chunk and starts a new one. Content before the first `##` heading is treated as a chunk with an empty heading (the frontmatter omits `section` for these).

Each chunk file is written to `output/<hostname>/chunks/<page-slug>/chunk-NNN.md` with zero-padded three-digit numbering.

`buildFrontmatter()` produces the YAML block:

- `source`: the original URL of the page
- `title`: the page title from Readability
- `page`: relative path to the full page file
- `chunk`: 1-based index of this chunk within the page
- `total`: total number of chunks for this page
- `section`: the `##` heading text (omitted if the chunk precedes all headings)

This schema works directly with vector store loaders that read YAML frontmatter as document metadata.

**`exporters/siteIndexWriter.ts`**

Writes three files:

`index.md`: a Markdown table of all pages sorted by depth then slug, with columns for title (linked to the page file), word count, estimated reading time, depth, and source URL. Reading time is at 200 wpm with a minimum of 1 minute. Failed URLs are listed in a separate section at the bottom.

`sitemap.json`: a JSON array where each entry contains:

```json
{
  "url": "https://...",
  "slug": "getting-started",
  "filename": "pages/getting-started.md",
  "title": "Getting Started",
  "depth": 1,
  "wordCount": 842,
  "readingTimeMin": 5,
  "linksTo": ["pages/installation.md", "pages/api-reference.md"]
}
```

`linksTo` is resolved from the page's outbound URLs through the registry. Only crawled URLs appear. This is a page graph an agent can traverse without reading individual files.

`metadata.json`: the full `CrawlStats` object as JSON.

**`exporters/markdownExport.ts` and `exporters/jsonExport.ts`**

Single-file exporters for single-page mode. Write a `.md` or `.json` file to a specified output path.

---

### Utility Layer

**`utils/fetch.ts`**

Thin Axios wrapper with a `Mozilla/5.0 crawl2md` User-Agent header. In single-page mode it exits the process on failure. In crawl mode the `fetchHTML()` inside `SiteCrawler.ts` throws on failure so the caller can log and continue.

**`utils/slugify.ts`**

Two functions: `urlToSlug()` and `makeUniqueSlug()`. Described in the PageRegistry section above.

**`utils/url.ts`**

Converts a URL to a default output filename for single-page mode. Extracts the hostname and pathname, joins them with a dash, strips non-word characters, and appends `.md`.

---

## Data Lifecycle Summary

```
URL string
  -> UrlFilter.normalize()         canonical URL (no hash, no query, no trailing slash)
  -> CrawlQueue.enqueue()          FIFO queue entry at a given depth
  -> fetchHTML()                   raw HTML string
  -> extractReadableContent()      { title: string, content: string (HTML) }
  -> htmlToMarkdown()              Markdown string
  -> PageRegistry.register()       PageRecord (with slug, wordCount, filename)
  -> writePages()                  pages/<slug>.md
  -> writeChunks() (optional)      chunks/<slug>/chunk-NNN.md (with YAML frontmatter)
  -> writeSiteIndex()              index.md, sitemap.json, metadata.json
```

---

## Architectural Constraints and Trade-offs

**Sequential crawling**

The BFS loop is sequential, one page at a time. A 100-page site at 300ms average round-trip takes about 30 seconds. Concurrent fetching would be faster but risks rate limits or IP bans on documentation hosts, and adds complexity around shared queue and registry state. For a tool you run once to build a local knowledge base, sequential is fine.

**In-memory registry**

All `PageRecord` objects are held in memory for the lifetime of the crawl. This works fine for documentation sites in the tens-to-low-hundreds of pages. For larger crawls, a streaming or disk-backed registry would be the right next step.

**Readability as the only content extractor**

Readability handles article content well but can struggle with heavy JavaScript-rendered SPAs, pages where the main content isn't in a block it recognizes, or pages with no prose (pure tables or code). Pages that return empty content are silently skipped. Writing an empty file just adds noise.

**No JavaScript rendering**

Axios fetches raw server-rendered HTML. Pages that need JavaScript to render (React, Vue, Next.js client-side routes) will return empty content or just the static shell. Adding a headless browser would make the tool much heavier. For JS-rendered sites, use a pre-rendered or SSR URL.

**Chunk boundary at `##` only**

Chunks split on second-level headings. This produces semantically coherent sections. Splitting on every heading level creates fragments that lack context; not splitting at all creates chunks too large to embed efficiently. `##` is the right default for documentation where `#` is the page title and `##` marks major sections.

---

## Output as a Knowledge Base

The `output/<hostname>/` directory is self-contained and ready to use:

- `index.md`: what pages exist, navigable by title
- `sitemap.json`: the page graph, traversable without reading individual files
- `metadata.json`: provenance, coverage, and settings of the crawl
- `pages/*.md`: clean documents with relative links to related pages
- `chunks/<slug>/chunk-NNN.md`: RAG-ready embedding units with all metadata in frontmatter

You can commit the whole directory to a repo, point an agent config at it, or load it into a vector store. The agent works entirely from local content with no further web access needed.
