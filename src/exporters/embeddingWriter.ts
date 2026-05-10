import fs from "fs";
import path from "path";
import { PageRegistry } from "../crawler/PageRegistry.js";
import { ChunkOptions, splitIntoChunks } from "./chunkWriter.js";

export type EmbeddingFormat = "generic" | "pinecone" | "chroma" | "qdrant" | "weaviate";

interface EmbeddingRecord {
  id: string;
  text: string;
  metadata: {
    source: string;
    title: string;
    page: string;
    chunk: number;
    total: number;
    section?: string;
  };
}

function buildRecords(registry: PageRegistry, hostname: string, chunkOpts: ChunkOptions): EmbeddingRecord[] {
  const records: EmbeddingRecord[] = [];

  for (const page of registry.getAll()) {
    if (!page.markdownContent) continue;

    const chunks = splitIntoChunks(page.markdownContent, chunkOpts);
    chunks.forEach((chunk, i) => {
      const num = String(i + 1).padStart(3, "0");
      const record: EmbeddingRecord = {
        id: `${hostname}/${page.slug}/chunk-${num}`,
        text: chunk.content,
        metadata: {
          source: page.url,
          title: page.title,
          page: `pages/${page.filename}`,
          chunk: i + 1,
          total: chunks.length,
        },
      };
      if (chunk.heading) record.metadata.section = chunk.heading;
      records.push(record);
    });
  }

  return records;
}

function toJsonl(objects: unknown[]): string {
  return objects.map((o) => JSON.stringify(o)).join("\n");
}

export function writeEmbeddings(
  registry: PageRegistry,
  outputDir: string,
  hostname: string,
  format: EmbeddingFormat,
  chunkOpts: ChunkOptions
): number {
  const records = buildRecords(registry, hostname, chunkOpts);
  if (records.length === 0) {
    console.log("No embedding records to write.");
    return 0;
  }

  let filename: string;
  let content: string;

  switch (format) {
    case "pinecone": {
      filename = "embeddings.jsonl";
      content = toJsonl(
        records.map((r) => ({ id: r.id, metadata: { text: r.text, ...r.metadata } }))
      );
      break;
    }
    case "chroma": {
      filename = "embeddings.json";
      content = JSON.stringify(
        {
          ids: records.map((r) => r.id),
          documents: records.map((r) => r.text),
          metadatas: records.map((r) => r.metadata),
        },
        null,
        2
      );
      break;
    }
    case "qdrant": {
      filename = "embeddings.json";
      content = JSON.stringify(
        { points: records.map((r) => ({ id: r.id, payload: { text: r.text, ...r.metadata } })) },
        null,
        2
      );
      break;
    }
    case "weaviate": {
      filename = "embeddings.jsonl";
      content = toJsonl(
        records.map((r) => ({
          class: "Chunk",
          properties: { content: r.text, chunkId: r.id, ...r.metadata },
        }))
      );
      break;
    }
    default: {
      filename = "embeddings.jsonl";
      content = toJsonl(records);
    }
  }

  const outPath = path.join(outputDir, filename);
  fs.writeFileSync(outPath, content, "utf-8");
  console.log(`Wrote ${records.length} embedding records (${format}) to ${outPath}`);
  return records.length;
}
