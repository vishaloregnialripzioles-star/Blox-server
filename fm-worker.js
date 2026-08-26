const http = require('http');

const PLACE_ID = 2753915549;
const POLL_MS = Math.max(5000, Number(process.env.FM_POLL_MS) || 15000);
const REPORT_TOKEN = process.env.FM_REPORT_TOKEN || '';
const PORT = Number(process.env.FM_WORKER_PORT) || 10001;
const MAX_SERVERS_PER_PAGE = 100;

const state = {
  running: false,
  lastScanAt: null,
  nextCursor: null,
  servers: new Map(),
  fullMoonReports: new Map(),
  lastError: null,
};

async function fetchServers(cursor = null) {
  const url = new URL(`https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public`);
  url.searchParams.set('sortOrder', '2');
  url.searchParams.set('excludeFullGames', 'true');
  url.searchParams.set('limit', String(MAX_SERVERS_PER_PAGE));
  if (cursor) url.searchParams.set('cursor', cursor);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Roblox servers API returned ${response.status}`);
  return response.json();
}

async function scanOnce() {
  state.running = true;
  state.lastError = null;
  try {
    // Public Roblox server discovery gives us JobIds and player counts.
    // It does NOT expose Blox Fruits' in-game moon state.
    const page = await fetchServers(state.nextCursor);
    for (const server of page.data || []) {
      state.servers.set(server.id, {
        jobId: server.id,
        playing: server.playing,
        maxPlayers: server.maxPlayers,
        seenAt: Date.now(),
      });
    }
    state.nextCursor = page.nextPageCursor || null;
    if (!state.nextCursor) state.nextCursor = null;
    state.lastScanAt = new Date().toISOString();
  } catch (error) {
    state.lastError = error.message;
  } finally {
    state.running = false;
  }
}

function pruneReports() {
  const cutoff = Date.now() - 2 * 60 * 1000;
  for (const [jobId, report] of state.fullMoonReports) {
    if (report.reportedAt < cutoff) state.fullMoonReports.delete(jobId);
  }
}

// A trusted game-side observer can POST a verified Full Moon observation here.
// This endpoint deliberately does not pretend the public server API can detect FM.
async function handleReport(req, res) {
  if (REPORT_TOKEN && req.headers.authorization !== `Bearer ${REPORT_TOKEN}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  let body = '';
  for await (const chunk of req) body += chunk;

  try {
    const report = JSON.parse(body);
    if (!report.jobId || report.fullMoon !== true) throw new Error('jobId and fullMoon=true are required');

    state.fullMoonReports.set(String(report.jobId), {
      jobId: String(report.jobId),
      fullMoon: true,
      playing: Number(report.playing) || 0,
      maxPlayers: Number(report.maxPlayers) || 0,
      reportedAt: Date.now(),
    });

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      worker: 'running',
      lastScanAt: state.lastScanAt,
      serversTracked: state.servers.size,
      verifiedFullMoonServers: state.fullMoonReports.size,
      lastError: state.lastError,
    }));
    return;
  }

  if (req.method === 'GET' && req.url === '/fm') {
    pruneReports();
    const results = [...state.fullMoonReports.values()].map((report) => ({
      ...report,
      joinUrl: `https://www.roblox.com/games/start?placeId=${PLACE_ID}&gameInstanceId=${encodeURIComponent(report.jobId)}`,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ placeId: PLACE_ID, results }));
    return;
  }

  if (req.method === 'POST' && req.url === '/fm-report') {
    await handleReport(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`FM worker listening on ${PORT}`);
  console.log(`Scanning Blox Fruits place ${PLACE_ID}`);
});

scanOnce();
setInterval(scanOnce, POLL_MS);

module.exports = {
  state,
  scanOnce,
  PLACE_ID,
};
