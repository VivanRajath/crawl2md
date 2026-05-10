import fs from "fs";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import { PageRegistry } from "./PageRegistry.js";
import { CrawlQueue } from "./CrawlQueue.js";
import { UrlFilter } from "./UrlFilter.js";
import { CrawlCache } from "./CrawlCache.js";
import { extractReadableContent } from "../parser/readability.js";
import { htmlToMarkdown } from "../parser/markdown.js";
import { writePages } from "../exporters/pageWriter.js";
import { writeChunks, ChunkOptions, ChunkStrategy } from "../exporters/chunkWriter.js";
import { writeEmbeddings, EmbeddingFormat } from "../exporters/embeddingWriter.js";
import { writeAgentExport } from "../exporters/agentWriter.js";
import { writeSiteIndex } from "../exporters/siteIndexWriter.js";

export interface CrawlOptions {
  maxDepth: number;
  maxPages: number;
  include?: string[];
  exclude?: string[];
  chunks?: boolean;
  chunkSize?: number;
  chunkOverlap?: number;
  chunkStrategy?: string;
  embeddings?: boolean;
  embeddingsFormat?: string;
  update?: boolean;
  format?: string;
  outputDir?: string;
}

export interface CrawlStats {
  seedUrl: string;
  crawledAt: string;
  durationMs: number;
  attempted: number;
  succeeded: number;
  cachedPages: number;
  skipped: number;
  totalWords: number;
  avgWordsPerPage: number;
  maxDepthReached: number;
  totalChunks: number;
  embeddingRecords: number;
  options: {
    maxDepth: number;
    maxPages: number;
    include: string[];
    exclude: string[];
    chunks: boolean;
    chunkSize: number;
    chunkOverlap: number;
    chunkStrategy: string;
    embeddings: boolean;
    embeddingsFormat: string;
    update: boolean;
    format: string;
  };
  failedUrls: string[];
}

export interface CrawlResult {
  registry: PageRegistry;
  hostname: string;
  stats: CrawlStats;
}

interface FetchResult {
  html: string;
  etag?: string;
  lastModified?: string;
  unchanged: boolean;
}

async function fetchPage(url: string, cachedEntry?: { etag?: string; lastModified?: string; hash?: string }, checkHash = false): Promise<FetchResult> {
  const headers: Record<string, string> = { "User-Agent": "Mozilla/5.0 crawl2md" };
  if (cachedEntry?.etag) headers["If-None-Match"] = cachedEntry.etag;
  else if (cachedEntry?.lastModified) headers["If-Modified-Since"] = cachedEntry.lastModified;

  const response = await axios.get(url, {
    headers,
    timeout: 10000,
    validateStatus: (s) => s === 304 || (s >= 200 && s < 300),
  });

  if (response.status === 304) {
    return { html: "", etag: cachedEntry?.etag, lastModified: cachedEntry?.lastModified, unchanged: true };
  }

  const html = String(response.data);
  const etag = response.headers["etag"] as string | undefined;
  const lastModified = response.headers["last-modified"] as string | undefined;

  if (checkHash && cachedEntry?.hash && CrawlCache.hash(html) === cachedEntry.hash) {
    return { html, etag, lastModified, unchanged: true };
  }

  return { html, etag, lastModified, unchanged: false };
}

function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      links.add(new URL(href, baseUrl).toString());
    } catch {
      // ignore unparseable hrefs
    }
  });
  return [...links];
}

export async function runSiteCrawler(seedUrl: string, options: CrawlOptions): Promise<CrawlResult> {
  const chunkOpts: ChunkOptions = {
    strategy: (options.chunkStrategy ?? "heading") as ChunkStrategy,
    maxTokens: options.chunkSize ?? 512,
    overlapTokens: options.chunkOverlap ?? 50,
  };

  const filter = new UrlFilter(seedUrl, { include: options.include, exclude: options.exclude });
  const registry = new PageRegistry();
  const queue = new CrawlQueue();

  const normalizedSeed = filter.normalize(seedUrl);
  queue.enqueue(normalizedSeed, 0);

  const hostname = new URL(seedUrl).hostname;
  const outputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.join(process.cwd(), "output", hostname);
  fs.mkdirSync(outputDir, { recursive: true });

  // Load cache for incremental mode
  const crawlCache = options.update ? new CrawlCache(outputDir) : null;
  if (crawlCache) {
    crawlCache.load();
    console.log("Incremental mode: loaded cache, skipping unchanged pages.");
  }

  console.log(`\nStarting crawl: ${normalizedSeed}`);
  console.log(`Limits: depth=${options.maxDepth}, pages=${options.maxPages}`);
  if (options.include?.length) console.log(`Include: ${options.include.join(", ")}`);
  if (options.exclude?.length) console.log(`Exclude: ${options.exclude.join(", ")}`);
  console.log();

  const startTime = Date.now();
  const crawledAt = new Date().toISOString();
  const failedUrls: string[] = [];
  let attempted = 0;
  let cachedPages = 0;

  while (!queue.isEmpty()) {
    if (registry.size() >= options.maxPages) {
      console.log(`Page limit (${options.maxPages}) reached, stopping.`);
      break;
    }

    const entry = queue.next()!;
    if (entry.depth > options.maxDepth) continue;

    attempted++;
    console.log(`[${registry.size() + 1}] depth=${entry.depth} ${entry.url}`);

    const cachedEntry = crawlCache?.get(entry.url);
    let fetchResult: FetchResult;

    try {
      fetchResult = await fetchPage(entry.url, cachedEntry, options.update ?? false);
    } catch (err: any) {
      console.warn(`  SKIP (fetch failed): ${err.message}`);
      failedUrls.push(entry.url);
      continue;
    }

    // Page is unchanged — restore from cache and continue
    if (fetchResult.unchanged && cachedEntry) {
      console.log(`  CACHED`);
      registry.registerCached(
        entry.url,
        cachedEntry.slug,
        cachedEntry.title,
        cachedEntry.wordCount,
        entry.depth,
        cachedEntry.outboundUrls
      );
      cachedPages++;

      // Keep crawling outbound links from cached entry
      if (entry.depth < options.maxDepth) {
        for (const u of cachedEntry.outboundUrls) {
          if (!queue.hasSeen(u) && !registry.has(u)) {
            queue.enqueue(u, entry.depth + 1);
          }
        }
      }
      continue;
    }

    const html = fetchResult.html;

    let article: { title: string; content: string };
    try {
      article = extractReadableContent(html, entry.url);
    } catch {
      console.warn(`  SKIP (parse failed)`);
      failedUrls.push(entry.url);
      continue;
    }

    if (!article.content) {
      console.warn(`  SKIP (no readable content)`);
      continue;
    }

    const rawLinks = extractLinks(html, entry.url);
    const outboundUrls = rawLinks
      .map((u) => filter.normalize(u))
      .filter((u) => filter.allow(u));

    const markdownContent = htmlToMarkdown(article.content);

    const record = registry.register({
      url: entry.url,
      title: article.title,
      depth: entry.depth,
      outboundUrls,
      markdownContent,
    });

    // Update cache entry for this page
    if (crawlCache) {
      crawlCache.set(entry.url, {
        hash: CrawlCache.hash(html),
        crawledAt: new Date().toISOString(),
        etag: fetchResult.etag,
        lastModified: fetchResult.lastModified,
        title: record.title,
        slug: record.slug,
        wordCount: record.wordCount,
        outboundUrls: record.outboundUrls,
      });
    }

    if (entry.depth < options.maxDepth) {
      for (const u of outboundUrls) {
        if (!queue.hasSeen(u) && !registry.has(u)) {
          queue.enqueue(u, entry.depth + 1);
        }
      }
    }
  }

  const durationMs = Date.now() - startTime;
  const pages = registry.getAll();
  const activePage = pages.filter((p) => p.markdownContent);
  const totalWords = pages.reduce((sum, p) => sum + p.wordCount, 0);

  console.log(
    `\nCrawl complete. ${activePage.length} new/changed + ${cachedPages} cached = ${pages.length} total pages in ${(durationMs / 1000).toFixed(1)}s`
  );

  writePages(registry, outputDir);

  let totalChunks = 0;
  if (options.chunks) {
    totalChunks = writeChunks(registry, outputDir, chunkOpts);
  }

  let embeddingRecords = 0;
  if (options.embeddings) {
    embeddingRecords = writeEmbeddings(
      registry,
      outputDir,
      hostname,
      (options.embeddingsFormat ?? "generic") as EmbeddingFormat,
      chunkOpts
    );
  }

  if (options.format === "agent") {
    writeAgentExport(registry, outputDir, hostname);
  }

  const stats: CrawlStats = {
    seedUrl: normalizedSeed,
    crawledAt,
    durationMs,
    attempted,
    succeeded: activePage.length,
    cachedPages,
    skipped: attempted - activePage.length - cachedPages,
    totalWords,
    avgWordsPerPage: pages.length > 0 ? Math.round(totalWords / pages.length) : 0,
    maxDepthReached: pages.length > 0 ? Math.max(...pages.map((p) => p.depth)) : 0,
    totalChunks,
    embeddingRecords,
    options: {
      maxDepth: options.maxDepth,
      maxPages: options.maxPages,
      include: options.include ?? [],
      exclude: options.exclude ?? [],
      chunks: options.chunks ?? false,
      chunkSize: chunkOpts.maxTokens,
      chunkOverlap: chunkOpts.overlapTokens,
      chunkStrategy: chunkOpts.strategy,
      embeddings: options.embeddings ?? false,
      embeddingsFormat: options.embeddingsFormat ?? "generic",
      update: options.update ?? false,
      format: options.format ?? "markdown",
    },
    failedUrls,
  };

  writeSiteIndex(registry, outputDir, stats);

  if (crawlCache) crawlCache.save();

  console.log(`Output: ${outputDir}`);
  return { registry, hostname, stats };
}
