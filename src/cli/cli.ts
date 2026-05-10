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
    .option("--chunks", "Also write RAG-ready chunks with YAML frontmatter")
    .option("--output <dir>", "Output directory (default: output/<hostname>)")
    .action(async (url, options) => {
      await runSiteCrawler(url, {
        maxDepth: options.crawl ? parseInt(options.depth) : 0,
        maxPages: options.crawl ? parseInt(options.maxPages) : 1,
        include: options.include,
        exclude: options.exclude,
        chunks: options.chunks ?? false,
        outputDir: options.output,
      });
    });

  program.parse();
}
