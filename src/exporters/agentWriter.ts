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
  extractContextualTriples,
  Relationship,
  ContextualTriple,
} from "../parser/extractors.js";
import { pageContextToJSON, SemanticDepth } from "../parser/contextExtractor.js";
import {
  buildUnifiedGraph,
  PerPageGraphData,
  UnifiedEntity,
} from "./graphBuilder.js";

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
  contextualRelationships?: ContextualTriple[];
  entityContexts?: Record<string, string[]>;
  definitions?: Array<{ term: string; definition: string }>;
  codeLanguages: string[];
  externalLinks: string[];
  internalLinks: string[];
}

export function writeAgentExport(
  registry: PageRegistry,
  outputDir: string,
  hostname: string,
  semanticDepth: SemanticDepth = "standard"
): void {
  const agentDir = path.join(outputDir, "agent");
  fs.mkdirSync(agentDir, { recursive: true });

  const allPages = registry.getAll().filter((p) => !!p.markdownContent);
  const perPageGraphData: PerPageGraphData[] = [];

  const knowledgeGraph: Array<{
    url: string;
    slug: string;
    title: string;
    depth: number;
    concepts: string[];
    entities: string[];
    apis: Array<{ method: string; path: string }>;
    relationships: Relationship[];
    contextualRelationships?: ContextualTriple[];
    linksTo: string[];
  }> = [];

  for (const page of allPages) {
    const concepts = extractConcepts(page.markdownContent);
    const namedEntities = extractNamedEntities(page.markdownContent);
    const apis = extractAPIs(page.markdownContent);
    const relationships = extractRelationships(page.markdownContent, namedEntities);

    // Extract contextual triples when semantic depth is enhanced or full
    const contextualRelationships =
      semanticDepth !== "standard"
        ? extractContextualTriples(page.markdownContent, namedEntities, page.pageContext ?? null)
        : undefined;

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

    // Add semantic context when depth is enhanced or full
    if (semanticDepth !== "standard" && page.pageContext) {
      agentPage.contextualRelationships = contextualRelationships;
      const ctxJSON = pageContextToJSON(page.pageContext);
      agentPage.entityContexts = ctxJSON.entityContexts as Record<string, string[]>;
      agentPage.definitions = ctxJSON.definitions as Array<{ term: string; definition: string }>;
    }

    fs.writeFileSync(
      path.join(agentDir, `${page.slug}.json`),
      JSON.stringify(agentPage, null, 2),
      "utf-8"
    );

    const graphNode: typeof knowledgeGraph[number] = {
      url: page.url,
      slug: page.slug,
      title: page.title,
      depth: page.depth,
      concepts,
      entities: namedEntities,
      apis,
      relationships,
      linksTo: internalLinks,
    };

    if (contextualRelationships && contextualRelationships.length > 0) {
      graphNode.contextualRelationships = contextualRelationships;
    }

    knowledgeGraph.push(graphNode);

    // Collect per-page data for graph builder
    perPageGraphData.push({
      url: page.url,
      slug: page.slug,
      title: page.title,
      entities: namedEntities,
      relationships,
      pageContext: page.pageContext ?? null,
    });
  }

  // Build unified knowledge graph when semantic depth is enhanced or full
  let graphOutput: Record<string, unknown> = { pages: knowledgeGraph };

  if (semanticDepth !== "standard" && perPageGraphData.length > 0) {
    const unified = buildUnifiedGraph(perPageGraphData);
    graphOutput = {
      pages: knowledgeGraph,
      unifiedEntities: unified.entities,
      crossPageEdges: unified.crossPageEdges,
    };
  }

  fs.writeFileSync(
    path.join(agentDir, "knowledge-graph.json"),
    JSON.stringify(graphOutput, null, 2),
    "utf-8"
  );

  const entityCount =
    semanticDepth !== "standard" && graphOutput.unifiedEntities
      ? (graphOutput.unifiedEntities as UnifiedEntity[]).length
      : 0;

  console.log(
    `Wrote ${allPages.length} agent pages + knowledge-graph.json to ${agentDir}` +
      (entityCount > 0 ? ` (${entityCount} unified entities)` : "")
  );
}
