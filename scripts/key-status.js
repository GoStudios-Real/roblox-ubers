// Verifies every configured key WITHOUT printing it.
// Run after rotating a key:  npm run keys
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
try {
  const envFile = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch { console.log('note: no .env found, only process env checked\n'); }

function mask(v) {
  if (!v) return '(not set)';
  return `${v.slice(0, 6)}…${v.slice(-4)}  [${v.length} chars]`;
}

async function check(label, fn) {
  try {
    const out = await fn();
    console.log(`  OK   ${label}: ${out}`);
    return true;
  } catch (e) {
    console.log(`  FAIL ${label}: ${e.message}`);
    return false;
  }
}

async function main() {
  let failed = 0;

  console.log('Configured secrets (masked):');
  console.log(`  OPENROUTER_API_KEY  ${mask(process.env.OPENROUTER_API_KEY)}`);
  console.log(`  STRIPE_SECRET_KEY   ${mask(process.env.STRIPE_SECRET_KEY)}`);
  console.log(`  ROBLOX_API_KEY      ${mask(process.env.ROBLOX_API_KEY)}`);
  console.log(`  TRACKING_TOKEN      ${mask(process.env.TRACKING_TOKEN)}\n`);

  console.log('Live validation:');

  if (process.env.OPENROUTER_API_KEY) {
    if (!(await check('OpenRouter', async () => {
      const r = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
      });
      if (r.status === 401) throw new Error('401 - key revoked or invalid (rotate it)');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      return `valid, ${d.data?.length || 0} models reachable`;
    }))) failed++;
  } else console.log('  SKIP OpenRouter: not set');

  if (process.env.STRIPE_SECRET_KEY) {
    if (!(await check('Stripe', async () => {
      const r = await fetch('https://api.stripe.com/v1/account', {
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }
      });
      const d = await r.json();
      if (!r.ok) throw new Error(`${r.status} ${d?.error?.message || ''}`.trim());
      if (!d.charges_enabled) {
        throw new Error(`key valid, but account not activated (needs onboarding: ${(d.requirements?.currently_due || []).slice(0, 4).join(', ') || 'see dashboard'})`);
      }
      return 'key valid, charges enabled';
    }))) failed++;
  } else console.log('  SKIP Stripe: not set');

  if (process.env.ROBLOX_API_KEY) {
    if (!(await check('Roblox Open Cloud', async () => {
      const uni = process.env.ROBLOX_UNIVERSE_ID_BROOKHAVEN;
      const url = uni ? `https://apis.roblox.com/cloud/v2/universes/${uni}` : 'https://apis.roblox.com/cloud/v2/users/1';
      const r = await fetch(url, { headers: { 'x-api-key': process.env.ROBLOX_API_KEY } });
      if (r.status === 401 || r.status === 403) throw new Error(`${r.status} - bad key or missing scope`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return 'valid';
    }))) failed++;
  } else console.log('  SKIP Roblox Open Cloud: not set (optional)');

  if (!(await check('Public Roblox APIs (no key needed)', async () => {
    const r = await fetch('https://games.roblox.com/v1/games?universeIds=1686885941');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return `${d.data?.[0]?.name} reachable`;
  }))) failed++;

  console.log(failed ? `\n${failed} check(s) failed` : '\nAll keys healthy.');
  process.exit(failed ? 1 : 0);
}

main();
