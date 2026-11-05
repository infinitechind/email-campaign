const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Replace {{key}} placeholders with values from the CSV row (keys are case-insensitive).
 * Unknown placeholders are left as-is. Pass html=true to escape values inserted into HTML bodies.
 */
export function render(tpl: string, data: Record<string, string>, html = false): string {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) lower[k.trim().toLowerCase()] = v ?? "";
  return tpl.replace(/\{\{\s*([\w.\- ]+?)\s*\}\}/g, (m, key: string) => {
    const k = key.toLowerCase();
    if (!(k in lower)) return m;
    return html ? escapeHtml(lower[k]) : lower[k];
  });
}

/** Placeholder names used in a template, e.g. ["name", "company"]. */
export function placeholders(...parts: string[]): string[] {
  const out = new Set<string>();
  for (const p of parts) for (const m of p.matchAll(/\{\{\s*([\w.\- ]+?)\s*\}\}/g)) out.add(m[1]);
  return [...out];
}
