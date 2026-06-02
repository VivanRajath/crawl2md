import { urlToSlug, makeUniqueSlug } from "../utils/slugify.js";
import { PageContext } from "../parser/contextExtractor.js";

export interface PageRecord {
  url: string;
  slug: string;
  filename: string;
  title: string;
  depth: number;
  outboundUrls: string[];
  markdownContent: string;
  wordCount: number;
  pageContext?: PageContext;
}

export class PageRegistry {
  private pages = new Map<string, PageRecord>();
  private usedSlugs = new Set<string>();

  has(url: string): boolean {
    return this.pages.has(url);
  }

  register(params: {
    url: string;
    title: string;
    depth: number;
    outboundUrls: string[];
    markdownContent: string;
    pageContext?: PageContext;
  }): PageRecord {
    const baseSlug = urlToSlug(params.url);
    const slug = makeUniqueSlug(baseSlug, this.usedSlugs);
    this.usedSlugs.add(slug);

    const record: PageRecord = {
      url: params.url,
      slug,
      filename: `${slug}.md`,
      title: params.title,
      depth: params.depth,
      outboundUrls: params.outboundUrls,
      markdownContent: params.markdownContent,
      wordCount: params.markdownContent.trim().split(/\s+/).filter(Boolean).length,
      pageContext: params.pageContext,
    };

    this.pages.set(params.url, record);
    return record;
  }

  // Used by incremental crawl to restore unchanged pages from cache without re-processing.
  // markdownContent is empty so page/chunk writers skip re-writing existing files.
  registerCached(
    url: string,
    slug: string,
    title: string,
    wordCount: number,
    depth: number,
    outboundUrls: string[]
  ): PageRecord {
    this.usedSlugs.add(slug);
    const record: PageRecord = {
      url,
      slug,
      filename: `${slug}.md`,
      title,
      depth,
      outboundUrls,
      markdownContent: "",
      wordCount,
    };
    this.pages.set(url, record);
    return record;
  }

  get(url: string): PageRecord | undefined {
    return this.pages.get(url);
  }

  getAll(): PageRecord[] {
    return [...this.pages.values()];
  }

  size(): number {
    return this.pages.size;
  }
}
