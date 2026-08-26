const PLACE_ID = 2753915549;
const POLL_MS = Math.max(5000, Number(process.env.FM_POLL_MS) || 15000);
const FM_SOURCE_URL = process.env.FM_SOURCE_URL || 'https://hostserver.porry.store/bloxfruit/bot/JobId/fullmoon';
const SOURCE_TIMEOUT_MS = Math.max(3000, Number(process.env.FM_SOURCE_TIMEOUT_MS) || 10000);
const MAX_SERVER_PAGES = Math.max(1, Math.min(10, Number(process.env.FM_SERVER_PAGES) || 10));

const state = {
  running: false,
  lastScanAt: null,
  lastSourceAt: null,
  lastSourceStatus: null,
  servers: new Map(),
  fullMoonReports: new Map(),
  lastError: null,
};

async function fetchServers(cursor = null) {
  const url = new URL(`https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public`);
  url.searchParams.set('sortOrder', '2');
  url.searchParams.set('excludeFullGames', 'true');
  url.searchParams.set('limit', '100');
  if (cursor) url.searchParams.set('cursor', cursor);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Roblox servers API returned ${response.status}`);
  return response.json();
}

function collectJobIds(value, result = new Set()) {
  if (typeof value === 'string') {
    const matches = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi);
    if (matches) matches.forEach((id) => result.add(id));
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJobIds(item, result);
    return result;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectJobIds(item, result);
  }
  return result;
}

async function fetchFullMoonSource() {
  if (!FM_SOURCE_URL) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const response = await fetch(FM_SOURCE_URL, {
      headers: { Accept: 'application/json,text/plain,*/*' },
      signal: controller.signal,
    });
    state.lastSourceStatus = response.status;
    if (!response.ok) throw new Error(`FM source returned HTTP ${response.status}`);
    const text = await response.text();
    state.lastSourceAt = new Date().toISOString();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch (_) {}
    return [...collectJobIds(parsed)];
  } finally {
    clearTimeout(timer);
  }
}

function pruneReports() {
  const cutoff = Date.now() - 2 * 60 * 1000;
  for (const [jobId, report] of state.fullMoonReports) {
    if (report.reportedAt < cutoff) state.fullMoonReports.delete(jobId);
  }
}

async function scanOnce() {
  if (state.running) return;
  state.running = true;
  state.lastError = null;
  try {
    let cursor = null;
    for (let pageNumber = 0; pageNumber < MAX_SERVER_PAGES; pageNumber += 1) {
      const page = await fetchServers(cursor);
      for (const server of page.data || []) {
        state.servers.set(server.id, {
          jobId: server.id,
          playing: server.playing,
          maxPlayers: server.maxPlayers,
          seenAt: Date.now(),
        });
      }
      cursor = page.nextPageCursor || null;
      if (!cursor) break;
    }

    const jobIds = await fetchFullMoonSource();
    const now = Date.now();
    const liveJobIds = new Set(jobIds);

    for (const [jobId, report] of state.fullMoonReports) {
      if (!liveJobIds.has(jobId) || now - report.reportedAt >= 2 * 60 * 1000) {
        state.fullMoonReports.delete(jobId);
      }
    }

    for (const jobId of jobIds) {
      const known = state.servers.get(jobId);
      if (!known) continue;
      state.fullMoonReports.set(jobId, {
        jobId,
        fullMoon: true,
        playing: known.playing,
        maxPlayers: known.maxPlayers,
        reportedAt: now,
        source: FM_SOURCE_URL,
      });
    }

    pruneReports();
    state.lastScanAt = new Date().toISOString();
  } catch (error) {
    state.lastError = error.message;
    state.lastScanAt = new Date().toISOString();
  } finally {
    state.running = false;
  }
}

scanOnce();
setInterval(scanOnce, POLL_MS);

module.exports = { state, scanOnce, PLACE_ID, FM_SOURCE_URL };
