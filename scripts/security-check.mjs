import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const ignoredFiles = new Set(['.env']);
const forbiddenPatterns = [
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'GitHub token', pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'UPI PIN assignment', pattern: /\bUPI[_ -]?PIN\s*[:=]\s*["']?\d{4,6}\b/i },
];

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    if (entry.isFile() && ignoredFiles.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(entryPath)));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

const findings = [];
for (const file of await filesUnder(root)) {
  const buffer = await readFile(file);
  if (buffer.includes(0)) continue;
  const content = buffer.toString('utf8');
  for (const forbidden of forbiddenPatterns) {
    if (forbidden.pattern.test(content)) {
      findings.push(`${path.relative(root, file)}: ${forbidden.name}`);
    }
  }
}

if (findings.length > 0) {
  console.error(`Security check failed:\n${findings.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('Security check passed: no forbidden credential or PIN patterns found.');
}
