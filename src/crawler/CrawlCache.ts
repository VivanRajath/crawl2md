import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface CacheEntry {
  hash: string;
  crawledAt: string;
  etag?: string;
  lastModified?: string;
  title: string;
  slug: string;
  wordCount: number;
  outboundUrls: string[];
}

export class CrawlCache {
  private data: Record<string, CacheEntry> = {};
  private filePath: string;

  constructor(outputDir: string) {
    this.filePath = path.join(outputDir, ".crawl-cache.json");
  }

  load(): void {
    if (fs.existsSync(this.filePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      } catch {
        this.data = {};
      }
    }
  }

  save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
  }

  get(url: string): CacheEntry | undefined {
    return this.data[url];
  }

  has(url: string): boolean {
    return !!this.data[url];
  }

  set(url: string, entry: CacheEntry): void {
    this.data[url] = entry;
  }

  static hash(html: string): string {
    return crypto.createHash("sha256").update(html).digest("hex");
  }

  isUnchanged(url: string, html: string): boolean {
    const entry = this.data[url];
    if (!entry) return false;
    return CrawlCache.hash(html) === entry.hash;
  }
}
