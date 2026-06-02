import * as cheerio from "cheerio";

export interface PageContext {
  entityContexts: Map<string, string[]>;       // entity → surrounding sentences
  definitions: Array<{ term: string; definition: string }>;
  causalChains: Array<{ cause: string; effect: string; sentence: string }>;
  sectionPaths: Map<string, string[]>;          // entity → [H2, H3, H4] paths
}

export type SemanticDepth = "standard" | "enhanced" | "full";

// Causal/connective keywords that signal relationship sentences
const CAUSAL_KEYWORDS = [
  "because", "therefore", "which means", "this enables", "as a result",
  "so that", "in order to", "this allows", "this requires", "this ensures",
  "consequently", "thus", "hence", "due to", "leads to", "results in",
  "depends on", "relies on", "builds on", "powered by",
];

// Patterns that introduce definitions: "X is Y", "X: Y", appositives
const DEFINITION_PATTERNS: RegExp[] = [
  /^(.{2,60})\s+is\s+(?:a|an|the)\s+(.{10,200})[.!]?$/i,
  /^(.{2,60})\s*[-–—:]\s+(.{10,200})[.!]?$/,
  /^(.{2,40}),\s+(?:a|an)\s+(.{10,200}),/i,
];

/**
 * Split text into sentences. Simple but effective for technical docs.
 */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by space+uppercase or end of string
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
}

/**
 * Extract section hierarchy from HTML headings.
 * Returns a flat list of { level, text, contentBelow } entries.
 */
function extractSectionHierarchy(html: string): Array<{
  level: number;
  text: string;
  content: string;
}> {
  const $ = cheerio.load(html);
  const sections: Array<{ level: number; text: string; content: string }> = [];

  // Collect all headings with their positions
  const headings: Array<{ level: number; text: string; el: any }> = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const tagName = (el as any).tagName?.toLowerCase() ?? "";
    const level = parseInt(tagName.replace("h", ""), 10);
    const text = $(el).text().trim();
    if (text && !isNaN(level)) {
      headings.push({ level, text, el: el as any });
    }
  });

  // For each heading, collect the text content until the next same-or-higher-level heading
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    let content = "";
    let sibling = $(heading.el).next();

    while (sibling.length > 0) {
      const tag = (sibling[0] as any)?.tagName?.toLowerCase() ?? "";
      if (/^h[1-6]$/.test(tag)) {
        const sibLevel = parseInt(tag.replace("h", ""), 10);
        if (sibLevel <= heading.level) break;
      }
      content += " " + sibling.text();
      sibling = sibling.next();
    }

    sections.push({
      level: heading.level,
      text: heading.text,
      content: content.trim(),
    });
  }

  return sections;
}

/**
 * Build the section path (e.g. ["Tutorial", "Dependencies", "Sub-dependencies"])
 * for each section based on heading nesting.
 */
function buildSectionPaths(
  sections: Array<{ level: number; text: string; content: string }>
): Map<number, string[]> {
  const pathMap = new Map<number, string[]>();
  const stack: Array<{ level: number; text: string }> = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    // Pop stack until we find a parent (lower level number = higher in hierarchy)
    while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
      stack.pop();
    }
    stack.push({ level: section.level, text: section.text });
    pathMap.set(i, stack.map((s) => s.text));
  }

  return pathMap;
}

/**
 * Extract entity context sentences: for each known entity, find the 1-3 sentences
 * around it that provide definitional or relational context.
 */
function extractEntityContexts(
  text: string,
  entities: string[],
  maxContextsPerEntity: number
): Map<string, string[]> {
  const contexts = new Map<string, string[]>();
  if (entities.length === 0) return contexts;

  const sentences = splitSentences(text);

  for (const entity of entities) {
    const entityContexts: string[] = [];
    const entityPattern = new RegExp(`\\b${escapeRegex(entity)}\\b`, "i");

    for (const sentence of sentences) {
      if (entityPattern.test(sentence) && sentence.length > 20) {
        // Prefer sentences that look definitional or relational
        const isDefinitional = /\b(?:is|are|was|were)\s+(?:a|an|the)\b/i.test(sentence);
        const isRelational = CAUSAL_KEYWORDS.some((kw) => sentence.toLowerCase().includes(kw));

        if (isDefinitional || isRelational) {
          entityContexts.unshift(sentence.slice(0, 300)); // prioritize these
        } else if (entityContexts.length < maxContextsPerEntity) {
          entityContexts.push(sentence.slice(0, 300));
        }
      }
    }

    if (entityContexts.length > 0) {
      contexts.set(entity, entityContexts.slice(0, maxContextsPerEntity));
    }
  }

  return contexts;
}

/**
 * Extract definitions from text: "X is a Y", "X — Y", "X, a Y,"
 */
function extractDefinitions(text: string): Array<{ term: string; definition: string }> {
  const definitions: Array<{ term: string; definition: string }> = [];
  const seen = new Set<string>();
  const sentences = splitSentences(text);

  for (const sentence of sentences) {
    for (const pattern of DEFINITION_PATTERNS) {
      const match = sentence.match(pattern);
      if (match) {
        const term = match[1].trim();
        const definition = match[2].trim();
        const key = term.toLowerCase();
        if (!seen.has(key) && term.length > 1 && definition.length > 5) {
          seen.add(key);
          definitions.push({ term, definition: definition.slice(0, 300) });
        }
      }
    }
  }

  return definitions.slice(0, 30);
}

/**
 * Extract causal chains: sentences containing causal/connective keywords.
 * Tries to identify a cause and effect within the sentence.
 */
function extractCausalChains(
  text: string
): Array<{ cause: string; effect: string; sentence: string }> {
  const chains: Array<{ cause: string; effect: string; sentence: string }> = [];
  const sentences = splitSentences(text);

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    for (const keyword of CAUSAL_KEYWORDS) {
      const idx = lower.indexOf(keyword);
      if (idx === -1) continue;

      const cause = sentence.slice(0, idx).trim().replace(/[,;]$/, "").trim();
      const effect = sentence.slice(idx + keyword.length).trim().replace(/^[,;]\s*/, "").trim();

      if (cause.length > 10 && effect.length > 10) {
        chains.push({
          cause: cause.slice(0, 200),
          effect: effect.slice(0, 200),
          sentence: sentence.slice(0, 400),
        });
        break; // one match per sentence
      }
    }
  }

  return chains.slice(0, 20);
}

/**
 * Map entities to the section hierarchy paths where they appear.
 */
function mapEntitiesToSections(
  sections: Array<{ level: number; text: string; content: string }>,
  sectionPathMap: Map<number, string[]>,
  entities: string[]
): Map<string, string[]> {
  const entitySections = new Map<string, string[]>();

  for (const entity of entities) {
    const pattern = new RegExp(`\\b${escapeRegex(entity)}\\b`, "i");

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (pattern.test(section.content) || pattern.test(section.text)) {
        const paths = sectionPathMap.get(i);
        if (paths && paths.length > 0) {
          // Use the deepest/most-specific path where the entity appears
          const existing = entitySections.get(entity);
          if (!existing || paths.length > existing.length) {
            entitySections.set(entity, [...paths]);
          }
        }
      }
    }
  }

  return entitySections;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Main extraction function. Runs on Readability HTML output (before Turndown).
 * The `entities` parameter should come from extractNamedEntities() run on the
 * markdown — call this after markdown conversion but before final output.
 *
 * For `enhanced` depth: entityContexts + definitions + sectionPaths
 * For `full` depth: all of the above + causalChains
 */
export function extractPageContext(
  readabilityHtml: string,
  entities: string[],
  depth: SemanticDepth
): PageContext {
  if (depth === "standard") {
    return {
      entityContexts: new Map(),
      definitions: [],
      causalChains: [],
      sectionPaths: new Map(),
    };
  }

  // Get plain text from the HTML for sentence-level analysis
  const $ = cheerio.load(readabilityHtml);
  const plainText = $("body").text() || $.text() || "";

  // Extract section hierarchy from the HTML structure
  const sections = extractSectionHierarchy(readabilityHtml);
  const sectionPathMap = buildSectionPaths(sections);

  // Entity contexts: surrounding sentences for each entity
  const maxContexts = depth === "full" ? 5 : 3;
  const entityContexts = extractEntityContexts(plainText, entities, maxContexts);

  // Definitions
  const definitions = extractDefinitions(plainText);

  // Section paths for entities
  const sectionPaths = mapEntitiesToSections(sections, sectionPathMap, entities);

  // Causal chains (full depth only)
  const causalChains = depth === "full" ? extractCausalChains(plainText) : [];

  return {
    entityContexts,
    definitions,
    causalChains,
    sectionPaths,
  };
}

/**
 * Convert a PageContext to a JSON-serializable object.
 */
export function pageContextToJSON(ctx: PageContext): Record<string, unknown> {
  return {
    entityContexts: Object.fromEntries(ctx.entityContexts),
    definitions: ctx.definitions,
    causalChains: ctx.causalChains.length > 0 ? ctx.causalChains : undefined,
    sectionPaths: Object.fromEntries(ctx.sectionPaths),
  };
}
