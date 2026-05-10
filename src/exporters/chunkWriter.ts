import fs from "fs";
import path from "path";
import { PageRegistry, PageRecord } from "../crawler/PageRegistry.js";

export type ChunkStrategy = "heading" | "paragraph" | "token";

export interface ChunkOptions {
  strategy: ChunkStrategy;
  maxTokens: number;
  overlapTokens: number;
}

export interface Chunk {
  heading: string;
  content: string;
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function applyOverlap(chunks: Chunk[], overlapTokens: number): Chunk[] {
  if (overlapTokens <= 0 || chunks.length <= 1) return chunks;
  const overlapChars = overlapTokens * 4;
  return chunks.map((chunk, i) => {
    if (i === 0) return chunk;
    const tail = chunks[i - 1].content.slice(-overlapChars).trim();
    return { ...chunk, content: tail ? `${tail}\n\n${chunk.content}` : chunk.content };
  });
}

function chunkByHeading(markdown: string, maxTokens: number): Chunk[] {
  const lines = markdown.split("\n");
  const raw: Chunk[] = [];
  let currentHeading = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      const accumulated = currentLines.join("\n").trim();
      if (accumulated) raw.push({ heading: currentHeading, content: accumulated });
      currentHeading = line.replace(/^## /, "").trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  const last = currentLines.join("\n").trim();
  if (last) raw.push({ heading: currentHeading, content: last });

  // Sub-split oversized heading chunks on paragraph boundaries
  const result: Chunk[] = [];
  for (const chunk of raw) {
    if (approxTokens(chunk.content) <= maxTokens) {
      result.push(chunk);
    } else {
      for (const sub of splitByParagraph(chunk.content, maxTokens)) {
        result.push({ heading: chunk.heading, content: sub });
      }
    }
  }
  return result;
}

function splitByParagraph(markdown: string, maxTokens: number): string[] {
  const paragraphs = markdown.split(/\n\n+/);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = approxTokens(para);
    if (currentTokens + paraTokens > maxTokens && current.length > 0) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentTokens = 0;
    }
    current.push(para);
    currentTokens += paraTokens;
  }
  if (current.length > 0) chunks.push(current.join("\n\n"));
  return chunks;
}

function chunkByParagraph(markdown: string, maxTokens: number): Chunk[] {
  return splitByParagraph(markdown, maxTokens).map((c) => ({ heading: "", content: c }));
}

function chunkByToken(markdown: string, maxTokens: number): Chunk[] {
  const chunkChars = maxTokens * 4;
  const chunks: Chunk[] = [];
  let offset = 0;
  while (offset < markdown.length) {
    const slice = markdown.slice(offset, offset + chunkChars).trim();
    if (slice) chunks.push({ heading: "", content: slice });
    offset += chunkChars;
  }
  return chunks;
}

export function splitIntoChunks(markdown: string, opts: ChunkOptions): Chunk[] {
  let chunks: Chunk[];
  switch (opts.strategy) {
    case "paragraph":
      chunks = chunkByParagraph(markdown, opts.maxTokens);
      break;
    case "token":
      chunks = chunkByToken(markdown, opts.maxTokens);
      break;
    default:
      chunks = chunkByHeading(markdown, opts.maxTokens);
  }
  return applyOverlap(chunks, opts.overlapTokens);
}

function buildFrontmatter(page: PageRecord, chunk: Chunk, index: number, total: number): string {
  const lines = [
    "---",
    `source: "${page.url}"`,
    `title: "${page.title.replace(/"/g, '\\"')}"`,
    `page: "pages/${page.filename}"`,
    `chunk: ${index}`,
    `total: ${total}`,
  ];
  if (chunk.heading) lines.push(`section: "${chunk.heading.replace(/"/g, '\\"')}"`);
  lines.push("---");
  return lines.join("\n");
}

export function writeChunks(registry: PageRegistry, outputDir: string, opts: ChunkOptions): number {
  const chunksDir = path.join(outputDir, "chunks");
  let totalChunks = 0;

  for (const page of registry.getAll()) {
    if (!page.markdownContent) continue;

    const chunks = splitIntoChunks(page.markdownContent, opts);
    if (chunks.length === 0) continue;

    const pageChunksDir = path.join(chunksDir, page.slug);
    fs.mkdirSync(pageChunksDir, { recursive: true });

    chunks.forEach((chunk, i) => {
      const num = String(i + 1).padStart(3, "0");
      const frontmatter = buildFrontmatter(page, chunk, i + 1, chunks.length);
      fs.writeFileSync(
        path.join(pageChunksDir, `chunk-${num}.md`),
        `${frontmatter}\n\n${chunk.content}`,
        "utf-8"
      );
      totalChunks++;
    });
  }

  console.log(`Wrote ${totalChunks} chunks to ${chunksDir}`);
  return totalChunks;
}
