import fs from "fs";
import path from "path";
import { PageRegistry, PageRecord } from "../crawler/PageRegistry.js";

function buildRelatedSection(page: PageRecord, registry: PageRegistry): string {
  const related: PageRecord[] = [];

  for (const url of page.outboundUrls) {
    const record = registry.get(url);
    if (record && record.url !== page.url) {
      related.push(record);
    }
  }

  if (related.length === 0) return "";

  const links = related.map((r) => `- [${r.title}](./${r.filename})`).join("\n");
  return `\n\n## Related Pages\n\n${links}`;
}

export function writePages(registry: PageRegistry, outputDir: string): void {
  const pagesDir = path.join(outputDir, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });

  let written = 0;
  for (const page of registry.getAll()) {
    if (!page.markdownContent) continue; // cached page, file already exists on disk

    const related = buildRelatedSection(page, registry);
    const content = `# ${page.title}\n\n${page.markdownContent}${related}`;
    fs.writeFileSync(path.join(pagesDir, page.filename), content, "utf-8");
    written++;
  }

  console.log(`Wrote ${written} pages to ${pagesDir}`);
}
