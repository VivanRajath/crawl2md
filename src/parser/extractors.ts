const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "can", "this", "that", "these",
  "those", "it", "its", "from", "as", "not", "also", "you", "your",
  "we", "our", "they", "their", "if", "when", "then", "than", "so",
  "all", "each", "any", "more", "into", "about", "after", "before",
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
  const headings: string[] = [];
  for (const line of markdown.split("\n")) {
    if (/^#{1,3} /.test(line)) {
      const heading = line.replace(/^#+\s+/, "").trim().toLowerCase();
      if (heading) headings.push(heading);
    }
  }

  const wordFreq: Record<string, number> = {};
  const text = markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/[^a-zA-Z\s-]/g, " ")
    .toLowerCase();

  for (const word of text.split(/\s+/)) {
    if (word.length > 3 && !STOPWORDS.has(word)) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }
  }

  const topKeywords = Object.entries(wordFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([w]) => w);

  return [...new Set([...headings.slice(0, 5), ...topKeywords])].slice(0, 15);
}

export function extractAPIs(markdown: string): Array<{ method: string; path: string }> {
  const apis = new Map<string, { method: string; path: string }>();
  const pattern = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[\w/{}:.-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(markdown)) !== null) {
    const key = `${m[1]}:${m[2]}`;
    if (!apis.has(key)) apis.set(key, { method: m[1], path: m[2] });
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

  // import x from "pkg" / require("pkg")
  const importPat = /(?:import\s+[\s\S]*?\s+from\s+|require\s*\(\s*)["']([^./][^"']*?)["']/g;
  while ((m = importPat.exec(markdown)) !== null) {
    pkgs.add(m[1].split("/")[0]);
  }

  // pip install pkg
  const pipPat = /pip(?:3)?\s+install\s+([\w-]+)/g;
  while ((m = pipPat.exec(markdown)) !== null) pkgs.add(m[1]);

  // npm install pkg / npm i pkg
  const npmPat = /npm\s+(?:install|i)\s+([\w@/-]+)/g;
  while ((m = npmPat.exec(markdown)) !== null) pkgs.add(m[1]);

  // cargo add pkg
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
