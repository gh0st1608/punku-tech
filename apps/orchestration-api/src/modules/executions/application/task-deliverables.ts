const secretPatterns = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=-]{8,}/gi,
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret|authorization)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
];

export function sanitizeTaskSummary(value: string | null): string | null {
  if (!value) return null;
  const ansiEscape = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
  let summary = value.replace(ansiEscape, "");
  for (const pattern of secretPatterns) summary = summary.replace(pattern, "[REDACTED]");
  summary = summary.replace(/[\t ]+\n/g, "\n").trim();
  if (!summary) return null;
  return summary.slice(0, 4000);
}

export function sanitizeArtifactPaths(paths: string[]): string[] {
  const safePaths = new Set<string>();
  for (const candidate of paths) {
    const path = candidate.replaceAll("\\", "/").trim();
    const segments = path.split("/");
    const containsControlCharacter = [...path].some((character) => character.charCodeAt(0) < 32);
    const containsSensitiveSegment = segments.some((segment) =>
      /^(?:\.env(?:\..*)?|.*(?:secret|credential|private[_-]?key).*|id_rsa(?:\.pub)?)$/i.test(
        segment,
      ),
    );
    if (
      !path ||
      path.length > 512 ||
      path.startsWith("/") ||
      /^[A-Za-z]:/.test(path) ||
      containsControlCharacter ||
      segments.some((segment) => segment === ".." || segment === ".") ||
      containsSensitiveSegment ||
      /\.(?:pem|key|p12|pfx)$/i.test(path)
    ) {
      continue;
    }
    safePaths.add(path);
    if (safePaths.size >= 100) break;
  }
  return [...safePaths];
}
