import fs from "fs";
import path from "path";
import { PageRegistry } from "../crawler/PageRegistry.js";
import {
  extractSummary,
  extractConcepts,
  extractAPIs,
  extractCodeLanguages,
  extractPackages,
  extractEnvVars,
  extractNamedEntities,
  extractRelationships,
  Relationship,
} from "../parser/extractors.js";

interface AgentPageExport {
  url: string;
  title: string;
  summary: string;
  concepts: string[];
  entities: {
    named: string[];
    packages: string[];
    envVars: string[];
  };
  apis: Array<{ method: string; path: string }>;
  relationships: Relationship[];
  codeLanguages: string[];
  externalLinks: string[];
  internalLinks: string[];
}

export function writeAgentExport(
  registry: PageRegistry,
  outputDir: string,
  hostname: string
): void {
  const agentDir = path.join(outputDir, "agent");
  fs.mkdirSync(agentDir, { recursive: true });

  const allPages = registry.getAll().filter((p) => !!p.markdownContent);
  const knowledgeGraph: Array<{
    url: string;
    slug: string;
    title: string;
    depth: number;
    concepts: string[];
    entities: string[];
    apis: Array<{ method: string; path: string }>;
    relationships: Relationship[];
    linksTo: string[];
  }> = [];

  for (const page of allPages) {
    const concepts = extractConcepts(page.markdownContent);
    const namedEntities = extractNamedEntities(page.markdownContent);
    const apis = extractAPIs(page.markdownContent);
    const relationships = extractRelationships(page.markdownContent, namedEntities);

    const internalLinks = page.outboundUrls
      .map((u) => registry.get(u)?.filename)
      .filter(Boolean)
      .map((f) => `pages/${f}`) as string[];

    const agentPage: AgentPageExport = {
      url: page.url,
      title: page.title,
      summary: extractSummary(page.markdownContent),
      concepts,
      entities: {
        named: namedEntities,
        packages: extractPackages(page.markdownContent),
        envVars: extractEnvVars(page.markdownContent),
      },
      apis,
      relationships,
      codeLanguages: extractCodeLanguages(page.markdownContent),
      externalLinks: page.outboundUrls.filter((u) => !u.includes(hostname)),
      internalLinks,
    };

    fs.writeFileSync(
      path.join(agentDir, `${page.slug}.json`),
      JSON.stringify(agentPage, null, 2),
      "utf-8"
    );

    knowledgeGraph.push({
      url: page.url,
      slug: page.slug,
      title: page.title,
      depth: page.depth,
      concepts,
      entities: namedEntities,
      apis,
      relationships,
      linksTo: internalLinks,
    });
  }

  fs.writeFileSync(
    path.join(agentDir, "knowledge-graph.json"),
    JSON.stringify(knowledgeGraph, null, 2),
    "utf-8"
  );

  console.log(`Wrote ${allPages.length} agent pages + knowledge-graph.json to ${agentDir}`);
}
