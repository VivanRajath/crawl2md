import { Relationship } from "../parser/extractors.js";
import { PageContext } from "../parser/contextExtractor.js";

export interface PerPageGraphData {
  url: string;
  slug: string;
  title: string;
  entities: string[];
  relationships: Relationship[];
  pageContext: PageContext | null;
}

export interface UnifiedEntity {
  canonical: string;
  aliases: string[];
  definition: string;
  appearsOn: string[];           // page slugs
  relationships: Relationship[]; // all relationships across pages
  contexts: string[];            // context sentences (top 5)
}

export interface UnifiedGraph {
  entities: UnifiedEntity[];
  crossPageEdges: Relationship[];
}

/**
 * Normalize an entity name to a comparison key.
 */
function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Build a unified knowledge graph from per-page extraction results.
 *
 * 1. Entity unification: merge entity references across pages by normalized name
 * 2. Cross-page edge inference: co-referenced, defined-in, frequently-co-occurring
 * 3. Entity enrichment: aggregate contexts, relationships, definitions
 */
export function buildUnifiedGraph(pages: PerPageGraphData[]): UnifiedGraph {
  // ── Step 1: Entity unification ──

  // Map: normalizedKey → { surfaceForms: Map<form, count>, pages: Set<slug> }
  const entityIndex = new Map<
    string,
    {
      surfaceForms: Map<string, number>;
      pages: Set<string>;
      relationships: Relationship[];
      contexts: string[];
      definitions: string[];
    }
  >();

  for (const page of pages) {
    for (const entity of page.entities) {
      const key = normalizeKey(entity);
      if (!key) continue;

      let entry = entityIndex.get(key);
      if (!entry) {
        entry = {
          surfaceForms: new Map(),
          pages: new Set(),
          relationships: [],
          contexts: [],
          definitions: [],
        };
        entityIndex.set(key, entry);
      }

      entry.surfaceForms.set(entity, (entry.surfaceForms.get(entity) ?? 0) + 1);
      entry.pages.add(page.slug);
    }

    // Aggregate relationships per entity
    for (const rel of page.relationships) {
      const subjectKey = normalizeKey(rel.subject);
      const objectKey = normalizeKey(rel.object);

      const subjectEntry = entityIndex.get(subjectKey);
      if (subjectEntry) {
        const relKey = `${rel.subject}:${rel.predicate}:${rel.object}`;
        if (!subjectEntry.relationships.some((r) => `${r.subject}:${r.predicate}:${r.object}` === relKey)) {
          subjectEntry.relationships.push(rel);
        }
      }
      const objectEntry = entityIndex.get(objectKey);
      if (objectEntry && objectKey !== subjectKey) {
        const relKey = `${rel.subject}:${rel.predicate}:${rel.object}`;
        if (!objectEntry.relationships.some((r) => `${r.subject}:${r.predicate}:${r.object}` === relKey)) {
          objectEntry.relationships.push(rel);
        }
      }
    }

    // Aggregate context sentences from pageContext
    if (page.pageContext) {
      for (const [entity, ctxSentences] of page.pageContext.entityContexts) {
        const key = normalizeKey(entity);
        const entry = entityIndex.get(key);
        if (entry) {
          for (const ctx of ctxSentences) {
            if (!entry.contexts.includes(ctx)) {
              entry.contexts.push(ctx);
            }
          }
        }
      }

      // Aggregate definitions
      for (const def of page.pageContext.definitions) {
        const key = normalizeKey(def.term);
        const entry = entityIndex.get(key);
        if (entry) {
          if (!entry.definitions.includes(def.definition)) {
            entry.definitions.push(def.definition);
          }
        }
      }
    }
  }

  // ── Step 2: Build unified entities ──

  const unifiedEntities: UnifiedEntity[] = [];

  for (const [, entry] of entityIndex) {
    // Only include entities that appear on at least 1 page
    if (entry.pages.size === 0) continue;

    // Pick the most-frequent surface form as canonical
    let canonical = "";
    let maxCount = 0;
    for (const [form, count] of entry.surfaceForms) {
      if (count > maxCount) {
        canonical = form;
        maxCount = count;
      }
    }

    const aliases = [...entry.surfaceForms.keys()].filter((f) => f !== canonical);

    // Pick the longest definition as the best one
    const definition = entry.definitions.sort((a, b) => b.length - a.length)[0] ?? "";

    unifiedEntities.push({
      canonical,
      aliases: aliases.length > 0 ? aliases : [],
      definition,
      appearsOn: [...entry.pages],
      relationships: entry.relationships.slice(0, 20),
      contexts: entry.contexts.slice(0, 5),
    });
  }

  // Sort by number of pages they appear on (most cross-referenced first)
  unifiedEntities.sort((a, b) => b.appearsOn.length - a.appearsOn.length);

  // ── Step 3: Cross-page edge inference ──

  const crossPageEdges: Relationship[] = [];
  const edgeKeys = new Set<string>();

  const addEdge = (subject: string, predicate: string, object: string) => {
    const key = `${subject}:${predicate}:${object}`;
    if (!edgeKeys.has(key) && subject !== object) {
      edgeKeys.add(key);
      crossPageEdges.push({ subject, predicate, object });
    }
  };

  // Build a page→entities lookup for co-occurrence
  const pageEntities = new Map<string, string[]>();
  for (const page of pages) {
    pageEntities.set(page.slug, page.entities);
  }

  // Build page→outbound links lookup
  // (We don't have this directly, but we can infer from the page data available)
  // Instead, look for entity co-occurrence across pages

  // Frequently co-occurring entities: if two unified entities appear on 2+ shared pages
  for (let i = 0; i < unifiedEntities.length; i++) {
    for (let j = i + 1; j < unifiedEntities.length; j++) {
      const a = unifiedEntities[i];
      const b = unifiedEntities[j];
      const sharedPages = a.appearsOn.filter((p) => b.appearsOn.includes(p));
      if (sharedPages.length >= 2) {
        addEdge(a.canonical, "frequently-co-occurring", b.canonical);
      }
    }
  }

  // Defined-in edges: if entity appears on many pages but has a definition from one specific page,
  // the page with the definition is the "defining" page
  for (const entity of unifiedEntities) {
    if (entity.definition && entity.appearsOn.length > 1) {
      // Find which page provided the definition
      for (const page of pages) {
        if (!entity.appearsOn.includes(page.slug)) continue;
        if (page.pageContext) {
          for (const def of page.pageContext.definitions) {
            if (normalizeKey(def.term) === normalizeKey(entity.canonical)) {
              addEdge(entity.canonical, "defined-in", page.title);
              break;
            }
          }
        }
      }
    }
  }

  return {
    entities: unifiedEntities.slice(0, 100),
    crossPageEdges: crossPageEdges.slice(0, 50),
  };
}
