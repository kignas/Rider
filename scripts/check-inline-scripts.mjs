// Extracts inline <script> blocks (no src attribute) from an HTML file and
// syntax-checks each with new Function(). Used by tests and the check script.
import fs from 'node:fs';

export function extractInlineScripts(html) {
  const scripts = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) scripts.push(m[1]);
  return scripts;
}

export function checkFile(file) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = extractInlineScripts(html);
  scripts.forEach((code, i) => {
    try {
      new Function(code); // throws on a syntax error
    } catch (err) {
      throw new Error(`${file}: inline script #${i + 1} has a syntax error: ${err.message}`);
    }
  });
  return scripts.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2);
  let total = 0;
  for (const f of files) total += checkFile(f);
  console.log(`Syntax OK — ${total} inline script block(s) across ${files.length} file(s).`);
}
