import TurndownService from "turndown";
import { SemanticDepth } from "./contextExtractor.js";

const GENERIC_ANCHOR_TEXTS = new Set([
  "here", "click here", "link", "website", "page", "read more", "learn more", "details", "source", "this"
]);

function isMeaningfulAnchor(text: string): boolean {
  const clean = text.trim().toLowerCase();
  if (clean.length < 3) return false;
  if (GENERIC_ANCHOR_TEXTS.has(clean)) return false;
  if (/^\d+$/.test(clean)) return false;
  try {
    new URL(text);
    return false;
  } catch {}
  return true;
}

export function htmlToMarkdown(html: string, semanticDepth: SemanticDepth = "standard"): string {
  const turndown = new TurndownService({ headingStyle: "atx" });
  const cellTurndown = new TurndownService({ headingStyle: "atx" });

  // Add rule for tables
  turndown.addRule("table", {
    filter: "table",
    replacement: function (content, node) {
      const table = node as any;
      const rows = Array.from(table.rows) as any[];
      if (rows.length === 0) return "";

      const markdownRows: string[][] = [];
      let maxCols = 0;

      for (const row of rows) {
        const cells = Array.from(row.cells) as any[];
        const cellTexts = cells.map((cell) => {
          // Turndown the cell HTML to preserve formatting
          return cellTurndown.turndown(cell.innerHTML).trim().replace(/\n+/g, " ");
        });
        maxCols = Math.max(maxCols, cellTexts.length);
        markdownRows.push(cellTexts);
      }

      if (markdownRows.length === 0) return "";

      const lines: string[] = [];
      const header = markdownRows[0];
      while (header.length < maxCols) header.push("");
      lines.push("| " + header.join(" | ") + " |");

      const separator = Array(maxCols).fill("---");
      lines.push("| " + separator.join(" | ") + " |");

      for (let i = 1; i < markdownRows.length; i++) {
        const row = markdownRows[i];
        while (row.length < maxCols) row.push("");
        lines.push("| " + row.join(" | ") + " |");
      }

      return "\n\n" + lines.join("\n") + "\n\n";
    },
  });

  // Add rule for definition lists (dl)
  turndown.addRule("dl", {
    filter: "dl",
    replacement: function (content, node) {
      const dl = node as any;
      const children = Array.from(dl.childNodes) as any[];
      let markdown = "";
      let currentTerm = "";

      for (const child of children) {
        if (child.nodeType !== 1) continue;
        const tagName = child.tagName.toLowerCase();
        if (tagName === "dt") {
          currentTerm = cellTurndown.turndown(child.innerHTML).trim();
        } else if (tagName === "dd") {
          const definition = cellTurndown.turndown(child.innerHTML).trim();
          if (currentTerm) {
            markdown += `**${currentTerm}**: ${definition}\n\n`;
            currentTerm = "";
          } else {
            markdown += `: ${definition}\n\n`;
          }
        }
      }
      return "\n\n" + markdown.trim() + "\n\n";
    },
  });

  // Add rule for links when semantic depth is enhanced or full
  if (semanticDepth !== "standard") {
    turndown.addRule("annotatedLink", {
      filter: "a",
      replacement: function (content, node) {
        const anchor = node as HTMLAnchorElement;
        const href = anchor.getAttribute("href") || "";
        const text = anchor.textContent || "";

        if (!href) return text;

        if (isMeaningfulAnchor(text)) {
          const parent = anchor.parentNode;
          let surroundingSentence = "";
          if (parent) {
            const parentText = parent.textContent || "";
            // Find the sentence containing the text
            const sentences = parentText.split(/(?<=[.!?])\s+/);
            const match = sentences.find((s) => s.includes(text));
            if (match) {
              surroundingSentence = match.trim().replace(/\n+/g, " ");
            }
          }

          if (surroundingSentence && surroundingSentence.length > text.length) {
            return `[${text}](${href}) <!-- link-context: ${surroundingSentence} -->`;
          }
        }

        return `[${text}](${href})`;
      },
    });
  }

  return turndown.turndown(html);
}