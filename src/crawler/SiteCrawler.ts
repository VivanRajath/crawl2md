import fs from "fs";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import { PageRegistry } from "./PageRegistry.js";
import { CrawlQueue } from "./CrawlQueue.js";
import { UrlFilter } from "./UrlFilter.js";
import { extractReadableContent } from "../parser/readability.js";
import { htmlToMarkdown } from "../parser/markdown.js";
import { writePages } from "../exporters/pageWriter.js";
import { writeSiteIndex } from "../exporters/siteIndexWriter.js";
import { writeChunks } from "../exporters/chunkWriter.js";

export interface CrawlOptions {
  maxDepth: number;
  maxPages: number;
  include?: string[];
  exclude?: string[];
  chunks?: boolean;
  outputDir?: string;
}

export interface CrawlStats {
  seedUrl: string;
  crawledAt: string;
  durationMs: number;
  attempted: number;
  succeeded: number;
  skipped: number;
  totalWords: number;
  avgWordsPerPage: number;
  maxDepthReached: number;
  totalChunks: number;
  options: {
    maxDepth: number;
    maxPages: number;
    include: string[];
    exclude: string[];
    chunks: boolean;
  };
  failedUrls: string[];
}

export interface CrawlResult {
  registry: PageRegistry;
  hostname: string;
  stats: CrawlStats;
}

async function fetchHTML(url: string): Promise<string> {
  const response = await axios.get(url, {
    headers: { "User-Agent": "Mozilla/5.0 crawl2md" },
    timeout: 10000,
  });
  return response.data;
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

export async function runSiteCrawler(
  seedUrl: string,
  options: CrawlOptions
): Promise<CrawlResult> {
  const filter = new UrlFilter(seedUrl, {
    include: options.include,
    exclude: options.exclude,
  });
  const registry = new PageRegistry();
  const queue = new CrawlQueue();

  const normalizedSeed = filter.normalize(seedUrl);
  queue.enqueue(normalizedSeed, 0);

  console.log(`\nStarting crawl: ${normalizedSeed}`);
  console.log(`Limits: depth=${options.maxDepth}, pages=${options.maxPages}`);
  if (options.include?.length) console.log(`Include: ${options.include.join(", ")}`);
  if (options.exclude?.length) console.log(`Exclude: ${options.exclude.join(", ")}`);
  console.log();

  const startTime = Date.now();
  const crawledAt = new Date().toISOString();
  const failedUrls: string[] = [];
  let attempted = 0;

  while (!queue.isEmpty()) {
    if (registry.size() >= options.maxPages) {
      console.log(`Page limit (${options.maxPages}) reached, stopping.`);
      break;
    }

    const entry = queue.next()!;
    if (entry.depth > options.maxDepth) continue;

    attempted++;
    console.log(`[${registry.size() + 1}] depth=${entry.depth} ${entry.url}`);

    let html: string;
    try {
      html = await fetchHTML(entry.url);
    } catch (err: any) {
      console.warn(`  SKIP (fetch failed): ${err.message}`);
      failedUrls.push(entry.url);
      continue;
    }

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

    registry.register({
      url: entry.url,
      title: article.title,
      depth: entry.depth,
      outboundUrls,
      markdownContent,
    });

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
  const totalWords = pages.reduce((sum, p) => sum + p.wordCount, 0);

  console.log(`\nCrawl complete. ${registry.size()} pages in ${(durationMs / 1000).toFixed(1)}s`);

  const hostname = new URL(seedUrl).hostname;
  const outputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.join(process.cwd(), "output", hostname);
  fs.mkdirSync(outputDir, { recursive: true });

  writePages(registry, outputDir);

  let totalChunks = 0;
  if (options.chunks) {
    totalChunks = writeChunks(registry, outputDir);
  }

  const stats: CrawlStats = {
    seedUrl: normalizedSeed,
    crawledAt,
    durationMs,
    attempted,
    succeeded: pages.length,
    skipped: attempted - pages.length,
    totalWords,
    avgWordsPerPage: pages.length > 0 ? Math.round(totalWords / pages.length) : 0,
    maxDepthReached: pages.length > 0 ? Math.max(...pages.map((p) => p.depth)) : 0,
    totalChunks,
    options: {
      maxDepth: options.maxDepth,
      maxPages: options.maxPages,
      include: options.include ?? [],
      exclude: options.exclude ?? [],
      chunks: options.chunks ?? false,
    },
    failedUrls,
  };

  writeSiteIndex(registry, outputDir, stats);

  console.log(`Output: ${outputDir}`);

  return { registry, hostname, stats };
}
