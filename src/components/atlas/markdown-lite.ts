/**
 * Markdown-lite renderer moved out of AssistantChat.tsx (Task 6) so both chat
 * message bodies (AssistantMessageBody) and any future consumers share one
 * implementation.
 *
 * HTML is escaped FIRST to prevent XSS — content comes from the LLM, which
 * could theoretically output raw HTML or be influenced by prompt injection.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderMarkdownLite(text: string) {
  let html = escapeHtml(text);
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Links — only allow http(s) URLs to prevent javascript: protocol injection
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" class="text-orange-600 hover:underline" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  // Also handle relative URLs (for TPI article links like /slug/); the (?!\/)
  // lookahead rejects protocol-relative "//host" hrefs from prompt injection
  html = html.replace(
    /\[([^\]]+)\]\((\/(?!\/)[^)]+)\)/g,
    '<a href="$2" class="text-orange-600 hover:underline">$1</a>'
  );

  // Table detection and conversion (before newline→br)
  const lines = html.split("\n");
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }

      if (tableLines.length >= 2) {
        const headerCells = tableLines[0].split("|").filter(c => c.trim() !== "").map(c => c.trim());

        let dataStart = 1;
        if (tableLines[1] && /^\|[\s\-:|]+\|$/.test(tableLines[1])) {
          dataStart = 2;
        }

        let tableHtml = '<table class="w-full text-xs border-collapse rounded-lg overflow-hidden my-3">';
        tableHtml += '<thead><tr class="bg-orange-50">';
        for (const cell of headerCells) {
          tableHtml += `<th class="px-3 py-2 text-left font-semibold text-gray-700 border-b border-orange-200">${cell}</th>`;
        }
        tableHtml += "</tr></thead><tbody>";

        for (let r = dataStart; r < tableLines.length; r++) {
          const cells = tableLines[r].split("|").filter(c => c.trim() !== "").map(c => c.trim());
          const rowClass = (r - dataStart) % 2 === 0 ? "bg-white" : "bg-gray-50";
          tableHtml += `<tr class="${rowClass}">`;
          for (const cell of cells) {
            tableHtml += `<td class="px-3 py-2 text-gray-700 border-b border-gray-100">${cell}</td>`;
          }
          tableHtml += "</tr>";
        }
        tableHtml += "</tbody></table>";
        result.push(tableHtml);
      } else {
        for (const line of tableLines) {
          result.push(line + "<br/>");
        }
      }
    } else {
      result.push(lines[i] + "<br/>");
      i++;
    }
  }

  html = result.join("");
  // Remove trailing br
  html = html.replace(/(<br\/>)+$/, "");
  return html;
}