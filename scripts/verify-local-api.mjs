const origin = process.env.SYSTEM_ATLAS_LOCAL_ORIGIN ?? "http://127.0.0.1:3001";
let lastError;
for (let attempt = 0; attempt < 20; attempt += 1) {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2_000) });
    const health = await response.json();
    if (response.ok && health.ready && health.liveCounts?.countries === 219 && health.liveCounts?.indicators === 87) process.exit(0);
    lastError = new Error(`Health check not ready: ${response.status} ${JSON.stringify(health)}`);
  } catch (error) { lastError = error; }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
throw lastError;
