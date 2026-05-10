import { Command } from "commander";
import { runSiteCrawler } from "../crawler/SiteCrawler.js";

const collect = (val: string, prev: string[]) => [...prev, val];

export function runCLI() {
  const program = new Command();

  program
    .name("crawl2md")
    .description("Convert websites into markdown knowledge directories")
    .argument("<url>", "Website URL")
    .option("--crawl", "Follow internal links (default: single page only)")
    .option("--depth <number>", "Max crawl depth (requires --crawl)", "3")
    .option("--max-pages <number>", "Max pages to crawl (requires --crawl)", "50")
    .option("--include <path>", "Only crawl URLs under this path prefix (repeatable)", collect, [])
    .option("--exclude <path>", "Skip URLs under this path prefix (repeatable)", collect, [])
    .option("--chunks", "Write RAG-ready chunk files with YAML frontmatter")
    .option("--chunk-size <n>", "Max tokens per chunk (requires --chunks)", "512")
    .option("--chunk-overlap <n>", "Overlap tokens between adjacent chunks (requires --chunks)", "50")
    .option("--chunk-strategy <s>", "Chunking strategy: heading, paragraph, token (requires --chunks)", "heading")
    .option("--embeddings", "Write embedding-ready export file")
    .option("--embeddings-format <fmt>", "Embedding format: generic, pinecone, chroma, qdrant, weaviate", "generic")
    .option("--update", "Only crawl pages that changed since the last crawl")
    .option("--format <fmt>", "Output format: markdown, agent", "markdown")
    .option("--output <dir>", "Output directory (default: output/<hostname>)")
    .action(async (url, options) => {
      await runSiteCrawler(url, {
        maxDepth: options.crawl ? parseInt(options.depth) : 0,
        maxPages: options.crawl ? parseInt(options.maxPages) : 1,
        include: options.include,
        exclude: options.exclude,
        chunks: options.chunks ?? false,
        chunkSize: parseInt(options.chunkSize),
        chunkOverlap: parseInt(options.chunkOverlap),
        chunkStrategy: options.chunkStrategy ?? "heading",
        embeddings: options.embeddings ?? false,
        embeddingsFormat: options.embeddingsFormat ?? "generic",
        update: options.update ?? false,
        format: options.format ?? "markdown",
        outputDir: options.output,
      });
    });

  program.parse();
}
