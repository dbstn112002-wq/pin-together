import { readFile } from 'node:fs/promises';

const config = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const matched = config.match(/"RELEASE_ANNOUNCEMENT"\s*:\s*("(?:\\.|[^"\\])*")/);
if (!matched) throw new Error('RELEASE_ANNOUNCEMENT is missing from wrangler.jsonc');
const releaseText = JSON.parse(matched[1]);

function deploymentKey(value='') {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const expected = deploymentKey(releaseText);
const endpoint = `https://pintogether-photo.com/internal/deployment-notification/v2?expected=${encodeURIComponent(expected)}`;
const deadline = Date.now() + 120_000;
let lastStatus = 0;
while (Date.now() < deadline) {
  try {
    const response = await fetch(endpoint, { method:'POST' });
    lastStatus = response.status;
    if (response.ok) {
      const result = await response.json();
      if (result.releaseId === expected && result.releaseText === releaseText) {
        console.log(`Deployment notification: ${response.status}`);
        console.log(JSON.stringify(result.delivery || {}));
        process.exit(0);
      }
    }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 2_000));
}
throw new Error(`The deployed release text was not ready after 120 seconds (last status: ${lastStatus}).`);
