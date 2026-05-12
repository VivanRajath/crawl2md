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

  // PascalCase words in prose (not inside code blocks)
  const noCode = markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");
  for (const m of noCode.matchAll(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g)) {
    const t = m[1];
    if (!PASCAL_EXCLUDE.has(t)) track(t);
  }

  // Capitalized multi-word proper nouns after "such as", "like", "using", "called", "named"
  const introductionPat = /(?:such as|like|using|called|named|powered by|built on|built with)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)?)/g;
  for (const m of noCode.matchAll(introductionPat)) {
    track(m[1].trim());
  }

  // Keep entities that appear at least once and aren't stopwords
  return [...entities.entries()]
    .filter(([term]) => !STOPWORDS.has(term.toLowerCase()))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 25)
    .map(([term]) => term);
}

export interface Relationship {
  subject: string;
  predicate: string;
  object: string;
}

const RELATIONSHIP_PATTERNS: Array<{ regex: RegExp; predicate: string }> = [
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

  for (const { regex, predicate } of RELATIONSHIP_PATTERNS) {
    for (const m of noCode.matchAll(regex)) {
      addRel(m[1], predicate, m[2]);
    }
  }

  // Co-occurrence within the same H2 section → "related-to"
  const sections = noCode.split(/^## .+$/m).filter(Boolean);
  for (const section of sections) {
    const sectionEntities = knownEntities.filter((e) =>
      new RegExp(`\\b${e}\\b`, "i").test(section)
    );
    for (let i = 0; i < sectionEntities.length; i++) {
      for (let j = i + 1; j < sectionEntities.length; j++) {
        addRel(sectionEntities[i], "related-to", sectionEntities[j]);
      }
    }
  }

  return [...rels.values()].slice(0, 40);
}
