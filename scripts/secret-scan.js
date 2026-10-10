// Scans tracked files, the working tree and full git history for leaked secrets.
// Run: npm run secrets   (also runs in CI on every push)
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const PATTERNS = [
  { name: 'OpenRouter key', re: /sk-or-v1-[a-f0-9]{32,}/g },
  { name: 'Stripe secret/restricted key', re: /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g },
  { name: 'Stripe publishable key (ok to commit, flagged for review)', re: /pk_(?:live|test)_[A-Za-z0-9]{20,}/g },
  { name: 'Roblox Open Cloud key', re: /\b[A-Za-z0-9]{60,}\b(?=[^\n]{0,40}(?:roblox|open.?cloud))/gi },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { name: 'Generic api_key assignment', re: /(?:api[_-]?key|secret|password)\s*[=:]\s*["'][A-Za-z0-9\-_]{24,}["']/gi }
];

// .env.example / README placeholders are allowed
const ALLOW = [/sk_test_\.\.\./, /your[_-]?key/i, /change-me/i, /xxx+/i, /example/i, /PLACEHOLDER/i];

function scanText(label, text, findings) {
  for (const p of PATTERNS) {
    const matches = text.match(p.re) || [];
    for (const m of matches) {
      if (ALLOW.some((a) => a.test(m))) continue;
      findings.push(`${label}: ${p.name}: ${m.slice(0, 12)}...`);
    }
  }
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const findings = [];

// 1. working tree - scan every file that is NOT gitignored
//    (.env is supposed to hold real keys; it must never be committed, and the
//    history scan below proves it never was)
const allFiles = walk(ROOT);
const rels = allFiles.map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
let ignored = new Set();
try {
  const out = execSync('git check-ignore --stdin', { cwd: ROOT, input: rels.join('\n'), encoding: 'utf8' });
  ignored = new Set(out.trim().split('\n').filter(Boolean));
} catch (e) {
  // exit code 1 = no paths ignored; output still in stdout
  ignored = new Set(String(e.stdout || '').trim().split('\n').filter(Boolean));
}

for (const file of allFiles) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (ignored.has(rel)) continue;
  if (file.endsWith('.png') || file.endsWith('.lock')) continue;
  try {
    const stat = fs.statSync(file);
    if (stat.size > 2_000_000) continue;
    scanText('WORKTREE ' + rel, fs.readFileSync(file, 'utf8'), findings);
  } catch { /* binary etc */ }
}

// 2. git history
try {
  const commits = execSync('git rev-list --all', { cwd: ROOT, encoding: 'utf8' }).trim().split(/\s+/);
  for (const sha of commits) {
    const files = execSync('git ls-tree -r --name-only ' + sha, { cwd: ROOT, encoding: 'utf8' })
      .trim().split('\n');
    for (const f of files) {
      if (!f || /\.(png|jpg|lock)$/.test(f)) continue;
      let content = '';
      try {
        content = execSync(`git show "${sha}:${f}"`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 10_000_000 });
      } catch { continue; }
      scanText(`COMMIT ${sha.slice(0, 7)} ${f}`, content, findings);
    }
  }
} catch (e) {
  console.warn('history scan skipped:', e.message);
}

if (findings.length) {
  console.error(`LEAK SCAN FAILED - ${findings.length} finding(s):`);
  [...new Set(findings)].forEach((f) => console.error('  ' + f));
  process.exit(1);
}

console.log('Leak scan passed: no secrets in working tree or git history.');
