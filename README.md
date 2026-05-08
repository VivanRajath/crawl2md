# crawl2md

Crawl any website and save it as a structured Markdown knowledge base. Good for feeding AI agents, building RAG pipelines, or just having offline docs.

## Documentation

- [Architecture Guide](./ARCHITECTURE.md)
- [Runbook](./RUNBOOK.md)

---

## Installation

**Run without installing (recommended):**

```bash
npx crawl2md <url>
```

**Install globally:**

```bash
npm install -g crawl2md
crawl2md <url>
```

**Install locally in a project:**

```bash
npm install crawl2md
npx crawl2md <url>
```

---

## The Problem

When an AI agent researches a webpage, most of its context window goes to mechanical work: fetching a URL, stripping HTML, parsing navigation and footers, extracting text. That's overhead, not the actual task. On a documentation site with dozens of pages, it adds up fast.

## What crawl2md Does

crawl2md moves that overhead off the agent and onto your local filesystem. Run it once against a URL or a full site. It fetches, parses, and converts every page to plain Markdown, then writes everything to a structured directory. After that, an agent reads local files with no HTTP requests, no HTML parsing, just content.

With `--chunks`, every page is split on its `##` headings into individual chunk files with YAML frontmatter (source URL, page title, section heading, chunk index, total count). Drop these directly into a vector store.

---

## Features

- Single-page fetch: convert any URL to a `.md` file in one command
- Full-site crawl: follow internal links up to a configurable depth and page cap
- RAG-ready chunking: split pages by `##` headings into chunk files with YAML frontmatter
- Hierarchical output directory: `pages/`, `chunks/`, `index.md`, `sitemap.json`, `metadata.json`
- URL filtering: include or exclude specific path prefixes
- Automatic noise removal: skips assets, login pages, feeds, admin paths, and fragment URLs
- Slug collision prevention: unique filenames even when two URLs map to the same slug
- Related page links: each page ends with a `## Related Pages` section
- Windows Git Bash support: path arguments like `/docs` are normalized automatically

---

## Quick Start

```bash
# Fetch a single page
npx crawl2md https://example.com

# Crawl an entire site
npx crawl2md https://docs.example.com --crawl

# Crawl with RAG chunks
npx crawl2md https://docs.example.com --crawl --chunks

# Crawl a specific section only
npx crawl2md https://docs.example.com --crawl --include /guides --max-pages 100
```

---

## Output Structure

```
output/
└── docs.example.com/
    ├── index.md           # table of all pages with word counts and depth
    ├── sitemap.json       # page graph with links between slugs
    ├── metadata.json      # crawl stats: duration, attempted, succeeded, failed URLs
    ├── pages/
    │   ├── getting-started.md
    │   ├── api-reference.md
    │   └── ...
    └── chunks/            # only when --chunks is passed
        ├── getting-started/
        │   ├── chunk-001.md
        │   ├── chunk-002.md
        │   └── ...
        └── ...
```

Each chunk file has YAML frontmatter:

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

---

## CLI Reference

| Flag | Default | Description |
|---|---|---|
| `--crawl` | off | Follow internal links instead of fetching only the seed URL |
| `--depth <n>` | `3` | Maximum link depth from the seed URL |
| `--max-pages <n>` | `50` | Hard cap on total pages crawled |
| `--include <path>` | none | Only crawl URLs whose path starts with this prefix. Repeatable. |
| `--exclude <path>` | none | Skip URLs whose path starts with this prefix. Repeatable. |
| `--chunks` | off | Write RAG-ready chunk files under `chunks/` |

---

## Tech Stack

| Library | Role |
|---|---|
| `axios` | HTTP fetching |
| `cheerio` | Link extraction from raw HTML |
| `jsdom` + `@mozilla/readability` | Article content extraction |
| `turndown` | HTML-to-Markdown conversion |
| `commander` | CLI argument parsing |
| `typescript` + `tsx` | Language and dev runtime |

---

## Project Layout

```
src/
├── index.ts
├── cli/         cli.ts
├── crawler/     SiteCrawler.ts  CrawlQueue.ts  PageRegistry.ts  UrlFilter.ts
├── parser/      readability.ts  htmlParser.ts  markdown.ts
├── exporters/   pageWriter.ts   chunkWriter.ts  siteIndexWriter.ts  markdownExport.ts  jsonExport.ts
└── utils/       fetch.ts  slugify.ts  url.ts
```

---

## License

ISC
