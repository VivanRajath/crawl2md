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

With `--chunks`, every page is split into chunk files with YAML frontmatter ready to drop into a vector store. With `--format agent`, each page is analyzed and exported as structured JSON with summaries, concepts, named entities, semantic relationships, APIs, and a knowledge graph — all extracted heuristically with no LLM calls.

---

## Features

- Single-page fetch or full-site crawl with depth and page cap controls
- RAG-ready chunking: heading, paragraph, or token-based strategies with configurable size and overlap
- Embedding export: JSONL/JSON formatted for Pinecone, Chroma, Qdrant, Weaviate, or generic use
- Agent export mode: per-page JSON with summaries, concepts, named entities, semantic relationships, APIs, packages, env vars, and a knowledge graph
- Incremental crawling: skip unchanged pages using content hashing and HTTP conditional requests
- URL filtering: include or exclude specific path prefixes
- Automatic noise removal: skips assets, login pages, feeds, admin paths, and fragment URLs
- Slug collision prevention: unique filenames even when two URLs map to the same slug
- Related page links: each page ends with a Related Pages section
- Custom output directory via `--output`
- Windows Git Bash support: path arguments like `/docs` are normalized automatically

---

## Quick Start

```bash
# Fetch a single page
npx crawl2md https://example.com

# Crawl an entire site
npx crawl2md https://docs.example.com --crawl

# Crawl with RAG chunks (token-aware, with overlap)
npx crawl2md https://docs.example.com --crawl --chunks --chunk-size 512 --chunk-overlap 50

# Generate embedding-ready export for Pinecone
npx crawl2md https://docs.example.com --crawl --embeddings --embeddings-format pinecone

# Agent-optimized export with knowledge graph
npx crawl2md https://docs.example.com --crawl --format agent

# Only re-crawl pages that changed since last run
npx crawl2md https://docs.example.com --crawl --update

# Write output to a specific directory
npx crawl2md https://docs.example.com --crawl --output ./my-knowledge-base
```

---

## Output Structure

```
output/
└── docs.example.com/
    ├── index.md              # table of all pages with word counts and depth
    ├── sitemap.json          # page graph with links between slugs
    ├── metadata.json         # crawl stats: duration, pages, words, options
    ├── embeddings.jsonl      # only when --embeddings is passed
    ├── .crawl-cache.json     # only when --update is used (internal cache)
    ├── pages/
    │   ├── getting-started.md
    │   └── ...
    ├── chunks/               # only when --chunks is passed
    │   └── getting-started/
    │       ├── chunk-001.md
    │       └── ...
    └── agent/                # only when --format agent is passed
        ├── getting-started.json
        ├── ...
        └── knowledge-graph.json
```

**Chunk frontmatter:**

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

**Agent page JSON:**

```json
{
  "url": "https://...",
  "title": "Getting Started",
  "summary": "First paragraph of the page...",
  "concepts": ["authentication", "api key", "rate limiting"],
  "entities": {
    "named": ["Pydantic", "Starlette", "uvicorn"],
    "packages": ["axios", "express"],
    "envVars": ["API_KEY", "DATABASE_URL"]
  },
  "apis": [{ "method": "GET", "path": "/api/v1/users" }],
  "relationships": [
    { "subject": "FastAPI", "predicate": "built-on", "object": "Starlette" },
    { "subject": "FastAPI", "predicate": "uses", "object": "Pydantic" }
  ],
  "codeLanguages": ["bash", "python"],
  "externalLinks": ["https://stripe.com/docs"],
  "internalLinks": ["pages/api-reference.md"]
}
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
| `--chunk-size <n>` | `512` | Max tokens per chunk (requires `--chunks`) |
| `--chunk-overlap <n>` | `50` | Overlap tokens between adjacent chunks (requires `--chunks`) |
| `--chunk-strategy <s>` | `heading` | Chunking strategy: `heading`, `paragraph`, `token` |
| `--embeddings` | off | Write embedding-ready export file |
| `--embeddings-format <fmt>` | `generic` | Format: `generic`, `pinecone`, `chroma`, `qdrant`, `weaviate` |
| `--update` | off | Only crawl pages that changed since the last crawl |
| `--format <fmt>` | `markdown` | Output format: `markdown`, `agent` |
| `--output <dir>` | `output/<hostname>` | Write output to this directory |

---

## Tech Stack

| Library | Role |
|---|---|
| `axios` | HTTP fetching with conditional request support |
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
├── crawler/     SiteCrawler.ts  CrawlQueue.ts  PageRegistry.ts  UrlFilter.ts  CrawlCache.ts
├── parser/      readability.ts  htmlParser.ts  markdown.ts  extractors.ts
├── exporters/   pageWriter.ts   chunkWriter.ts  embeddingWriter.ts  agentWriter.ts
│                siteIndexWriter.ts  markdownExport.ts  jsonExport.ts
└── utils/       fetch.ts  slugify.ts  url.ts
```

---

## License

ISC
