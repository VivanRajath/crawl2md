const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "can", "this", "that", "these",
  "those", "it", "its", "from", "as", "not", "also", "you", "your",
  "we", "our", "they", "their", "if", "when", "then", "than", "so",
  "all", "each", "any", "more", "into", "about", "after", "before",
  "use", "used", "using", "just", "like", "very", "such", "well",
  "make", "makes", "made", "get", "gets", "got", "way", "ways",
]);

import { PageContext } from "./contextExtractor.js";

// Multi-word Title Case phrases to exclude (common non-entity phrases)
const TITLE_CASE_EXCLUDE = new Set([
  "For Example", "In This", "See Also", "More Info", "Read More",
  "Click Here", "Learn More", "Go To", "Set Up", "How To",
  "Make Sure", "As Well", "At Least", "Right Now", "So Far",
]);

// PascalCase words that are generic English and not named entities
const PASCAL_EXCLUDE = new Set([
  "The", "This", "That", "These", "Those", "With", "When", "Then",
  "From", "Into", "Upon", "Here", "There", "Where", "Which", "While",
  "Also", "Just", "Even", "After", "Before", "Since", "Until", "During",
  "However", "Therefore", "Although", "Because", "Whether", "Without",
  "Another", "Example", "Examples", "Note", "Notes", "More", "Most",
  "Some", "Many", "Each", "Both", "Other", "Others", "Same", "Such",
  "First", "Second", "Third", "Last", "Next", "Above", "Below",
  "True", "False", "None", "Null", "Type", "Types", "Class", "Function",
  "String", "Number", "Boolean", "Object", "Array", "List", "Dict",
  "Request", "Response", "Error", "Result", "Value", "Data", "Info",
  "File", "Path", "Name", "User", "Item", "Items", "Model", "Models",
]);

export function extractSummary(markdown: string): string {
  const lines = markdown.split("\n");
  const paraLines: string[] = [];
  let capturing = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (capturing && paraLines.length > 0) break;
      continue;
    }
    if (/^#{1,6} /.test(trimmed)) continue;
    capturing = true;
    paraLines.push(trimmed);
  }

  return paraLines.join(" ").slice(0, 500);
}

export function extractConcepts(markdown: string): string[] {
  const seen = new Set<string>();
  const concepts: string[] = [];

  const add = (term: string) => {
    const t = term.trim().toLowerCase();
    if (t.length > 2 && !seen.has(t)) { seen.add(t); concepts.push(t); }
  };

  // H1-H3 headings
  for (const line of markdown.split("\n")) {
    if (/^#{1,3} /.test(line)) {
      add(line.replace(/^#+\s+/, "").trim());
    }
  }

  // Backtick-wrapped inline terms (high signal — always named things)
  const inlineCode = markdown.matchAll(/`([^`\n]{2,40})`/g);
  for (const m of inlineCode) {
    const term = m[1].trim();
    // Skip obvious code snippets (contains spaces + operators, pure numbers)
    if (!/[\s=(){}[\]]/.test(term) && !/^\d+$/.test(term)) add(term);
  }

  // Bold/italic terms
  const emphasisPat = /\*\*([^*\n]{2,40})\*\*|\*([^*\n]{2,30})\*/g;
  for (const m of markdown.matchAll(emphasisPat)) {
    const term = (m[1] ?? m[2]).trim();
    if (!/^\d+$/.test(term)) add(term);
  }

  // Word frequency on prose (keep code blocks this time — they're content-rich)
  const wordFreq: Record<string, number> = {};
  const prose = markdown
    .replace(/```[\s\S]*?```/g, (block) => block) // keep code blocks
    .replace(/`[^`]+`/g, "")                        // strip inline code (already captured)
    .replace(/[^a-zA-Z\s-]/g, " ")
    .toLowerCase();

  for (const word of prose.split(/\s+/)) {
    if (word.length > 3 && !STOPWORDS.has(word)) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }
  }

  const topKeywords = Object.entries(wordFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([w]) => w);

  for (const kw of topKeywords) add(kw);

  return concepts.slice(0, 30);
}

export function extractAPIs(markdown: string): Array<{ method: string; path: string }> {
  const apis = new Map<string, { method: string; path: string }>();

  const addAPI = (method: string, p: string) => {
    const key = `${method}:${p}`;
    if (!apis.has(key)) apis.set(key, { method, path: p });
  };

  // Explicit: GET /path, POST /path  (e.g. in tables, prose, curl examples)
  const explicitPat = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[\w/{}:.-]+)/g;
  for (const m of markdown.matchAll(explicitPat)) addAPI(m[1], m[2]);

  // Python decorator: @app.get("/path") / @router.post("/path") / @app.route("/path", methods=["POST"])
  const decoratorPat = /@(?:\w+\.)(get|post|put|patch|delete|head|options)\s*\(\s*["'](\/[^"']*?)["']/gi;
  for (const m of markdown.matchAll(decoratorPat)) addAPI(m[1].toUpperCase(), m[2]);

  // @app.route("/path", methods=["GET", "POST"]) — multi-method
  const routePat = /@(?:\w+\.)?route\s*\(\s*["'](\/[^"']*?)["'][^)]*methods\s*=\s*\[([^\]]+)\]/gi;
  for (const m of markdown.matchAll(routePat)) {
    const path = m[1];
    const methods = m[2].matchAll(/["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']/gi);
    for (const mm of methods) addAPI(mm[1].toUpperCase(), path);
  }

  // Express/Fastify JS: app.get('/path') / router.post('/path')
  const jsPat = /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*["'`](\/[^"'`]*?)["'`]/gi;
  for (const m of markdown.matchAll(jsPat)) addAPI(m[1].toUpperCase(), m[2]);

  // OpenAPI/Swagger path keys: /items/{id}: \n  get: / post:
  const openApiPathPat = /^(\s{0,4})(\/[\w/{}:.-]+)\s*:\s*\n(?:[\s\S]*?\n)*?\s+(get|post|put|patch|delete|head|options)\s*:/gim;
  for (const m of markdown.matchAll(openApiPathPat)) addAPI(m[3].toUpperCase(), m[2]);

  // ── Library function/method API detection ──
  const codeBlocks = markdown.match(/```[\s\S]*?```/g) || [];
  const codeText = codeBlocks.join("\n");

  // Library method calls: httpx.get(...), httpx.post(...), client.get(...), etc.
  // Matches: lib.method( — common in Python/JS library docs
  const libMethodPat = /\b([a-z][a-z0-9_]+)\.(get|post|put|patch|delete|head|options|request|stream)\s*\(/gi;
  for (const m of codeText.matchAll(libMethodPat)) {
    const lib = m[1];
    const method = m[2];
    addAPI(`${lib}.${method}`, "(function)");
  }

  // Class constructors: httpx.Client(...), httpx.AsyncClient(...), AsyncHTTPTransport(...)
  const ctorPat = /\b(?:([a-z][a-z0-9_]+)\.)?([A-Z][A-Za-z0-9]+)\s*\(/g;
  for (const m of codeText.matchAll(ctorPat)) {
    const lib = m[1] || "";
    const cls = m[2];
    if (PASCAL_EXCLUDE.has(cls)) continue;
    const fullName = lib ? `${lib}.${cls}` : cls;
    addAPI("constructor", fullName);
  }

  // Chained method calls on known objects: .stream(), .read(), .aread(), .aclose()
  const chainPat = /\.(stream|read|aread|aclose|close|send|build_request|raise_for_status)\s*\(/g;
  for (const m of codeText.matchAll(chainPat)) {
    addAPI("method", `.${m[1]}()`);
  }

  return [...apis.values()];
}

export function extractCodeLanguages(markdown: string): string[] {
  const langs = new Set<string>();
  const pattern = /```(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(markdown)) !== null) {
    langs.add(m[1].toLowerCase());
  }
  return [...langs];
}

export function extractPackages(markdown: string): string[] {
  const pkgs = new Set<string>();
  let m: RegExpExecArray | null;

  const importPat = /(?:import\s+[\s\S]*?\s+from\s+|require\s*\(\s*)["']([^./][^"']*?)["']/g;
  while ((m = importPat.exec(markdown)) !== null) {
    pkgs.add(m[1].split("/")[0]);
  }

  const pipPat = /pip(?:3)?\s+install\s+([\w-]+)/g;
  while ((m = pipPat.exec(markdown)) !== null) pkgs.add(m[1]);

  const npmPat = /npm\s+(?:install|i)\s+([\w@/-]+)/g;
  while ((m = npmPat.exec(markdown)) !== null) pkgs.add(m[1]);

  const cargoPat = /cargo\s+add\s+([\w-]+)/g;
  while ((m = cargoPat.exec(markdown)) !== null) pkgs.add(m[1]);

  return [...pkgs].slice(0, 20);
}

export function extractEnvVars(markdown: string): string[] {
  const COMMON_EXCLUDE = new Set([
    "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "HTTP", "HTTPS",
    "URL", "API", "SDK", "JSON", "HTML", "CSS", "JWT", "SQL", "OK",
    "TRUE", "FALSE", "NULL", "NONE", "EOF", "UTF",
  ]);

  const envVars = new Set<string>();
  const codeBlocks = markdown.match(/```[\s\S]*?```/g) || [];
  const pattern = /\b([A-Z][A-Z0-9_]{2,})\b/g;

  for (const block of codeBlocks) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(block)) !== null) {
      if (!COMMON_EXCLUDE.has(m[1])) envVars.add(m[1]);
    }
  }
  return [...envVars].slice(0, 20);
}

export function extractNamedEntities(markdown: string): string[] {
  const entities = new Map<string, number>(); // term → occurrence count

  const track = (term: string) => {
    entities.set(term, (entities.get(term) ?? 0) + 1);
  };

  // Backtick inline-code: `FastAPI`, `Pydantic` — highest confidence
  for (const m of markdown.matchAll(/`([^`\n]{2,40})`/g)) {
    const t = m[1].trim();
    if (!/[\s=(){}[\]]/.test(t) && !/^\d+$/.test(t)) track(t);
  }

  // Bold terms: **FastAPI**, **Pydantic**
  for (const m of markdown.matchAll(/\*\*([^*\n]{2,40})\*\*/g)) {
    track(m[1].trim());
  }

  const noCode = markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");

  // PascalCase words in prose (not inside code blocks)
  for (const m of noCode.matchAll(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g)) {
    const t = m[1];
    if (!PASCAL_EXCLUDE.has(t)) track(t);
  }

  // Relaxed CamelCase: short terms like OAuth, GraphQL, DevOps (uppercase + lowercase mix, ≥4 chars)
  for (const m of noCode.matchAll(/\b([A-Z][a-z]*[A-Z][A-Za-z]*)\b/g)) {
    const t = m[1];
    if (t.length >= 4 && !PASCAL_EXCLUDE.has(t) && !/^[A-Z]+$/.test(t)) track(t);
  }

  // Multi-word Title Case phrases: "API Gateway", "Rate Limiter", "Service Worker" (2-3 words)
  for (const m of noCode.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g)) {
    const phrase = m[1].trim();
    if (!TITLE_CASE_EXCLUDE.has(phrase) && phrase.length >= 5) track(phrase);
  }

  // Heading-based entities: H1-H3 headings are almost always entity names
  for (const line of markdown.split("\n")) {
    if (/^#{1,3} /.test(line)) {
      const heading = line.replace(/^#+\s+/, "").trim();
      if (heading.length > 2 && heading.length < 60) track(heading);
    }
  }

  // List-item entities: bullets starting with **Term**: or `Term` followed by description
  for (const m of markdown.matchAll(/^\s*[-*]\s+(?:\*\*([^*]{2,40})\*\*|`([^`]{2,40})`)\s*[:\-–—]/gm)) {
    const term = (m[1] ?? m[2]).trim();
    if (term.length > 1 && !/^\d+$/.test(term)) track(term);
  }

  // Capitalized multi-word proper nouns after "such as", "like", "using", "called", "named"
  const introductionPat = /(?:such as|like|using|called|named|powered by|built on|built with)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)?)/g;
  for (const m of noCode.matchAll(introductionPat)) {
    track(m[1].trim());
  }

  // ── Code-block entity extraction ──
  const codeBlocks = markdown.match(/```[\s\S]*?```/g) || [];
  const codeText = codeBlocks.join("\n");

  // Class constructors: Client(), AsyncClient(), AsyncHTTPTransport()
  for (const m of codeText.matchAll(/\b([A-Z][A-Za-z0-9]{2,})\s*\(/g)) {
    const cls = m[1];
    if (!PASCAL_EXCLUDE.has(cls)) track(cls);
  }

  // Library-qualified names: httpx.Client, httpx.get, httpcore.AsyncHTTPTransport
  for (const m of codeText.matchAll(/\b([a-z][a-z0-9_]+)\.([A-Z][A-Za-z0-9]+)\b/g)) {
    const lib = m[1];
    const cls = m[2];
    if (lib.length >= 2 && !PASCAL_EXCLUDE.has(cls)) {
      track(cls);
      track(lib);
    }
  }

  // Library-qualified function calls: httpx.get(), httpx.post(), client.stream()
  for (const m of codeText.matchAll(/\b([a-z][a-z0-9_]+)\.([a-z][a-z0-9_]+)\s*\(/g)) {
    const lib = m[1];
    const fn = m[2];
    // Track the library name as an entity if it looks meaningful
    if (lib.length >= 3 && !STOPWORDS.has(lib) && fn.length >= 2) {
      track(lib);
    }
  }

  // Import targets: from httpx import Client, AsyncClient
  for (const m of codeText.matchAll(/from\s+([a-z][a-z0-9_.]*)\s+import\s+(.+)/g)) {
    const lib = m[1].split(".")[0];
    if (lib.length >= 2 && !STOPWORDS.has(lib)) track(lib);
    // Track each imported name
    for (const imported of m[2].split(",")) {
      const name = imported.trim().split(/\s+/)[0]; // handle "X as Y"
      if (name && /^[A-Z]/.test(name) && !PASCAL_EXCLUDE.has(name)) track(name);
    }
  }

  // import statements: import httpx, import httpcore
  for (const m of codeText.matchAll(/^import\s+([a-z][a-z0-9_.]+)/gm)) {
    const lib = m[1].split(".")[0];
    if (lib.length >= 2 && !STOPWORDS.has(lib)) track(lib);
  }

  // Keep entities that appear at least once and aren't stopwords
  return [...entities.entries()]
    .filter(([term]) => !STOPWORDS.has(term.toLowerCase()))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 50)
    .map(([term]) => term);
}

export interface Relationship {
  subject: string;
  predicate: string;
  object: string;
}

const RELATIONSHIP_PATTERNS: Array<{ regex: RegExp; predicate: string }> = [
  // Original patterns
  { regex: /([A-Z][A-Za-z0-9]+)\s+is\s+built\s+(?:on|upon|with)\s+([A-Z][A-Za-z0-9]+)/g, predicate: "built-on" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+is\s+based\s+on\s+([A-Z][A-Za-z0-9]+)/g, predicate: "based-on" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+uses?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "uses" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+extends?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "extends" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+integrates?\s+with\s+([A-Z][A-Za-z0-9]+)/g, predicate: "integrates-with" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+provides?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "provides" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+requires?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "requires" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+supports?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "supports" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+implements?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "implements" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+wraps?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "wraps" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+depends?\s+on\s+([A-Z][A-Za-z0-9]+)/g, predicate: "depends-on" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+(?:is\s+)?compatible\s+with\s+([A-Z][A-Za-z0-9]+)/g, predicate: "compatible-with" },
  // New: Compositional
  { regex: /([A-Z][A-Za-z0-9]+)\s+(?:consists?\s+of|contains?)\s+([A-Z][A-Za-z0-9]+)/g, predicate: "contains" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+includes?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "includes" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+comprises?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "comprises" },
  // New: Functional
  { regex: /([A-Z][A-Za-z0-9]+)\s+handles?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "handles" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+manages?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "manages" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+processes?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "processes" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+transforms?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "transforms" },
  // New: Lifecycle
  { regex: /([A-Z][A-Za-z0-9]+)\s+creates?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "creates" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+initializes?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "initializes" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+configures?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "configures" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+deploys?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "deploys" },
  // New: Negative/replacement
  { regex: /([A-Z][A-Za-z0-9]+)\s+replaces?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "replaces" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+deprecates?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "deprecates" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+supersedes?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "supersedes" },
  // New: Enablement
  { regex: /([A-Z][A-Za-z0-9]+)\s+enables?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "enables" },
  { regex: /([A-Z][A-Za-z0-9]+)\s+powers?\s+([A-Z][A-Za-z0-9]+)/g, predicate: "powers" },
];

export function extractRelationships(markdown: string, knownEntities: string[]): Relationship[] {
  const rels = new Map<string, Relationship>();
  const entitySet = new Set(knownEntities.map((e) => e.toLowerCase()));

  const addRel = (subject: string, predicate: string, object: string) => {
    // Only keep relationships where at least one side is a known entity
    if (
      subject === object ||
      PASCAL_EXCLUDE.has(subject) ||
      PASCAL_EXCLUDE.has(object)
    ) return;
    if (
      entitySet.has(subject.toLowerCase()) ||
      entitySet.has(object.toLowerCase())
    ) {
      const key = `${subject}:${predicate}:${object}`;
      if (!rels.has(key)) rels.set(key, { subject, predicate, object });
    }
  };

  const noCode = markdown.replace(/```[\s\S]*?```/g, "");

  // Standard regex pattern matching (PascalCase subjects/objects)
  for (const { regex, predicate } of RELATIONSHIP_PATTERNS) {
    for (const m of noCode.matchAll(regex)) {
      addRel(m[1], predicate, m[2]);
    }
  }

  // Lowercase entity matching: find known entities in relationship sentences
  // This catches "the router uses middleware" where "router" and "middleware" are known entities
  for (const entity of knownEntities) {
    const escapedEntity = entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const entityPat = new RegExp(`\\b${escapedEntity}\\b`, "gi");

    const predicateWords = [
      { words: ["uses", "use"], pred: "uses" },
      { words: ["requires", "require"], pred: "requires" },
      { words: ["supports", "support"], pred: "supports" },
      { words: ["provides", "provide"], pred: "provides" },
      { words: ["extends", "extend"], pred: "extends" },
      { words: ["wraps", "wrap"], pred: "wraps" },
      { words: ["handles", "handle"], pred: "handles" },
      { words: ["manages", "manage"], pred: "manages" },
      { words: ["creates", "create"], pred: "creates" },
      { words: ["enables", "enable"], pred: "enables" },
      { words: ["replaces", "replace"], pred: "replaces" },
      { words: ["contains", "contain", "includes", "include"], pred: "contains" },
    ];

    const sentences = noCode.split(/[.!?]\s+/);
    for (const sentence of sentences) {
      if (!entityPat.test(sentence)) continue;
      entityPat.lastIndex = 0;

      // Check if another known entity appears in the same sentence with a predicate
      for (const otherEntity of knownEntities) {
        if (otherEntity === entity) continue;
        const otherPat = new RegExp(`\\b${otherEntity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (!otherPat.test(sentence)) continue;

        const lowerSentence = sentence.toLowerCase();
        for (const { words, pred } of predicateWords) {
          if (words.some((w) => lowerSentence.includes(w))) {
            // Figure out subject/object order based on position in sentence
            const entityIdx = lowerSentence.indexOf(entity.toLowerCase());
            const otherIdx = lowerSentence.indexOf(otherEntity.toLowerCase());
            if (entityIdx < otherIdx) {
              addRel(entity, pred, otherEntity);
            } else {
              addRel(otherEntity, pred, entity);
            }
            break;
          }
        }
      }
    }
  }

  // List-structure relationships: heading + bulleted list → structured edges
  // e.g., "## Dependencies\n- FastAPI\n- Pydantic" → each item requires/depends-on page topic
  const listStructurePat = /^(#{2,4})\s+(.+)$\n((?:\s*[-*]\s+.+\n?)+)/gm;
  const listHeadingPredicates: Record<string, string> = {
    dependencies: "depends-on", requirements: "requires", prerequisites: "requires",
    features: "provides", components: "contains", includes: "contains",
    supports: "supports", integrations: "integrates-with", plugins: "extends",
    tools: "uses", "built with": "built-on", technologies: "uses",
  };

  for (const m of noCode.matchAll(listStructurePat)) {
    const heading = m[2].trim().toLowerCase();
    const listBlock = m[3];
    const predicate = Object.entries(listHeadingPredicates).find(([key]) =>
      heading.includes(key)
    )?.[1];

    if (predicate) {
      const items = listBlock.match(/^\s*[-*]\s+\*\*(.+?)\*\*|^\s*[-*]\s+`(.+?)`|^\s*[-*]\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)?)/gm);
      if (items) {
        for (const item of items) {
          const cleaned = item.replace(/^\s*[-*]\s+/, "").replace(/\*\*/g, "").replace(/`/g, "").trim();
          if (cleaned && entitySet.has(cleaned.toLowerCase())) {
            // The page topic (first known entity or first heading entity) "predicate" this item
            const pageEntity = knownEntities[0];
            if (pageEntity && pageEntity !== cleaned) {
              addRel(pageEntity, predicate, cleaned);
            }
          }
        }
      }
    }
  }

  // Table-row relationships: parse Markdown tables for relational data
  const tablePattern = /^\|(.+)\|\s*\n\|[-| :]+\|\s*\n((?:\|.+\|\s*\n?)+)/gm;
  for (const m of noCode.matchAll(tablePattern)) {
    const headers = m[1].split("|").map((h) => h.trim().toLowerCase());
    const rows = m[2].trim().split("\n");

    // Check if headers suggest relationships (e.g., "Name | Type", "Feature | Description")
    const nameCol = headers.findIndex((h) => ["name", "feature", "component", "tool", "plugin", "package"].includes(h));
    if (nameCol >= 0) {
      for (const row of rows) {
        const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
        if (cells[nameCol]) {
          const term = cells[nameCol].replace(/\*\*/g, "").replace(/`/g, "").trim();
          if (term && entitySet.has(term.toLowerCase())) {
            // This entity appears in a table under the page topic
            const pageEntity = knownEntities[0];
            if (pageEntity && pageEntity !== term) {
              addRel(pageEntity, "related-to", term);
            }
          }
        }
      }
    }
  }

  // Co-occurrence within the same H2 section → "related-to"
  const sections = noCode.split(/^## .+$/m).filter(Boolean);
  for (const section of sections) {
    const sectionEntities = knownEntities.filter((e) =>
      new RegExp(`\\b${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(section)
    );
    for (let i = 0; i < sectionEntities.length; i++) {
      for (let j = i + 1; j < sectionEntities.length; j++) {
        addRel(sectionEntities[i], "related-to", sectionEntities[j]);
      }
    }
  }

  // ── Backtick-entity relationships ──
  // Catches: `X` uses `Y`, `X` wraps `Y`, `X` supports `Y` etc.
  const backtickRelPat = /`([^`\n]{2,30})`\s+(uses?|requires?|supports?|provides?|extends?|wraps?|handles?|replaces?|enables?|depends\s+on|built\s+on|based\s+on|integrates?\s+with|compatible\s+with|contains?)\s+`([^`\n]{2,30})`/gi;
  for (const m of markdown.matchAll(backtickRelPat)) {
    const subject = m[1].trim();
    const rawPred = m[2].trim().toLowerCase().replace(/\s+/g, "-");
    const object = m[3].trim();
    // Normalize predicate (strip trailing s for consistency)
    const predicate = rawPred.replace(/s$/, "").replace(/-$/, "");
    addRel(subject, predicate, object);
  }

  // ── Import/from relationships in code blocks ──
  const codeBlocks = markdown.match(/```[\s\S]*?```/g) || [];
  const codeText = codeBlocks.join("\n");

  // "from X import Y" → X contains Y
  for (const m of codeText.matchAll(/from\s+([a-z][a-z0-9_.]+)\s+import\s+([A-Z][A-Za-z0-9]+)/g)) {
    const lib = m[1].split(".")[0];
    const imported = m[2];
    if (entitySet.has(lib.toLowerCase()) || entitySet.has(imported.toLowerCase())) {
      addRel(lib, "contains", imported);
    }
  }

  // "import X" when X is a known entity → page topic uses X
  for (const m of codeText.matchAll(/^import\s+([a-z][a-z0-9_.]+)/gm)) {
    const lib = m[1].split(".")[0];
    if (entitySet.has(lib.toLowerCase()) && knownEntities[0]) {
      addRel(knownEntities[0], "uses", lib);
    }
  }

  return [...rels.values()].slice(0, 80);
}

// ── Contextual triples (requires PageContext from contextExtractor) ──

export interface ContextualTriple extends Relationship {
  context: string;    // the source sentence
  confidence: number; // heuristic confidence 0-1
  section: string;    // which H2 section it was found in
}

/**
 * Extract contextual triples using PageContext for sentence-level provenance.
 * These are richer than standard relationships — each triple carries the source
 * sentence and the section hierarchy where it was found.
 */
export function extractContextualTriples(
  markdown: string,
  knownEntities: string[],
  pageContext: PageContext | null
): ContextualTriple[] {
  if (!pageContext) return [];

  const triples: ContextualTriple[] = [];
  const seen = new Set<string>();
  const entitySet = new Set(knownEntities.map((e) => e.toLowerCase()));

  // For each entity's context sentences, try to find relationships
  for (const [entity, contexts] of pageContext.entityContexts) {
    for (const sentence of contexts) {
      // Look for other known entities in the same context sentence
      for (const otherEntity of knownEntities) {
        if (otherEntity === entity) continue;
        const otherPat = new RegExp(`\\b${otherEntity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (!otherPat.test(sentence)) continue;

        // Try to determine the predicate from the sentence
        const lowerSentence = sentence.toLowerCase();
        let predicate = "related-to";
        let confidence = 0.3;

        const predicateMap: Array<{ keywords: string[]; pred: string; conf: number }> = [
          { keywords: ["uses", "use", "using"], pred: "uses", conf: 0.8 },
          { keywords: ["requires", "require", "requiring", "needs"], pred: "requires", conf: 0.8 },
          { keywords: ["provides", "provide", "providing", "offers"], pred: "provides", conf: 0.7 },
          { keywords: ["extends", "extend", "extending"], pred: "extends", conf: 0.8 },
          { keywords: ["built on", "built with", "based on"], pred: "built-on", conf: 0.9 },
          { keywords: ["supports", "support", "supporting"], pred: "supports", conf: 0.7 },
          { keywords: ["handles", "handle", "handling"], pred: "handles", conf: 0.7 },
          { keywords: ["creates", "create", "creating"], pred: "creates", conf: 0.7 },
          { keywords: ["replaces", "replace", "replacing"], pred: "replaces", conf: 0.8 },
          { keywords: ["contains", "contain", "includes", "include"], pred: "contains", conf: 0.7 },
          { keywords: ["depends on", "relies on", "relying on"], pred: "depends-on", conf: 0.8 },
          { keywords: ["enables", "enable", "enabling", "allows"], pred: "enables", conf: 0.7 },
          { keywords: ["configures", "configure", "configuring"], pred: "configures", conf: 0.7 },
          { keywords: ["integrates with", "integrating with"], pred: "integrates-with", conf: 0.8 },
        ];

        for (const { keywords, pred, conf } of predicateMap) {
          if (keywords.some((kw) => lowerSentence.includes(kw))) {
            predicate = pred;
            confidence = conf;
            break;
          }
        }

        // Determine subject/object order from sentence position
        const entityIdx = lowerSentence.indexOf(entity.toLowerCase());
        const otherIdx = lowerSentence.indexOf(otherEntity.toLowerCase());
        const subject = entityIdx < otherIdx ? entity : otherEntity;
        const object = entityIdx < otherIdx ? otherEntity : entity;

        const key = `${subject}:${predicate}:${object}`;
        if (!seen.has(key) && subject !== object) {
          seen.add(key);
          // Find section path for this entity
          const sectionPath = pageContext.sectionPaths.get(entity);
          triples.push({
            subject,
            predicate,
            object,
            context: sentence.slice(0, 300),
            confidence,
            section: sectionPath ? sectionPath.join(" > ") : "",
          });
        }
      }
    }
  }

  // Also extract relationships from causal chains
  for (const chain of pageContext.causalChains) {
    // Check if known entities appear in cause or effect
    const causeEntities = knownEntities.filter((e) =>
      new RegExp(`\\b${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(chain.cause)
    );
    const effectEntities = knownEntities.filter((e) =>
      new RegExp(`\\b${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(chain.effect)
    );

    for (const causeEntity of causeEntities) {
      for (const effectEntity of effectEntities) {
        if (causeEntity === effectEntity) continue;
        const key = `${causeEntity}:causes:${effectEntity}`;
        if (!seen.has(key)) {
          seen.add(key);
          triples.push({
            subject: causeEntity,
            predicate: "causes",
            object: effectEntity,
            context: chain.sentence.slice(0, 300),
            confidence: 0.6,
            section: "",
          });
        }
      }
    }
  }

  return triples.slice(0, 40);
}
