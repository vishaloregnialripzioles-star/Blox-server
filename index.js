const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fmWorker = require('./fm-worker');

const PREFIX = '.';
const PORT = Number(process.env.PORT) || 10000;
const token = process.env.DISCORD_BOT_TOKEN;
const FIND_TIMEOUT_MS = Math.max(15000, Number(process.env.FM_FIND_TIMEOUT_MS) || 90000);
const FIND_INTERVAL_MS = Math.max(5000, Number(process.env.FM_FIND_INTERVAL_MS) || 7500);
const COLLECT_AFTER_FIRST_MS = Math.max(5000, Number(process.env.FM_COLLECT_AFTER_FIRST_MS) || 30000);

if (!token) {
  console.error('Missing DISCORD_BOT_TOKEN environment variable.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

function freshFullMoonServers() {
  const cutoff = Date.now() - 2 * 60 * 1000;
  return [...fmWorker.state.fullMoonReports.values()]
    .filter((report) => report.reportedAt >= cutoff)
    .sort((a, b) => (b.playing - a.playing) || (b.reportedAt - a.reportedAt));
}

function joinUrl(jobId) {
  return `https://www.roblox.com/games/start?placeId=${fmWorker.PLACE_ID}&gameInstanceId=${encodeURIComponent(jobId)}`;
}

function buildResultMessage(servers) {
  const lines = ['🌕 **Full Moon Servers Found**', '', '🎮 **Blox Fruits**', ''];
  const rows = [];
  servers.forEach((s, i) => {
    lines.push(`**${i + 1}.** 👥 ${s.playing}/${s.maxPlayers}`);
    const rowIndex = Math.floor(i / 5);
    if (rowIndex < 5) {
      if (!rows[rowIndex]) rows[rowIndex] = new ActionRowBuilder();
      rows[rowIndex].addComponents(
        new ButtonBuilder().setLabel(`Join #${i + 1}`).setStyle(ButtonStyle.Link).setURL(joinUrl(s.jobId))
      );
    }
  });
  if (servers.length > 25) lines.push('', `📋 Showing the first 25 of ${servers.length} verified servers because Discord limits buttons per message.`);
  lines.push('', '✅ Only servers returned by the FM verification source are listed.');
  return { content: lines.join('\n'), components: rows };
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok', bot: client.isReady() ? 'online' : 'starting', prefix: PREFIX,
      fmWorker: {
        source: fmWorker.FM_SOURCE_URL, lastScanAt: fmWorker.state.lastScanAt,
        lastSourceAt: fmWorker.state.lastSourceAt, lastSourceStatus: fmWorker.state.lastSourceStatus,
        serversTracked: fmWorker.state.servers.size, verifiedFullMoonServers: freshFullMoonServers().length,
        lastError: fmWorker.state.lastError,
      },
    }));
    return;
  }
  if (req.method === 'GET' && req.url === '/fm') {
    const results = freshFullMoonServers().map((report, index) => ({ rank: index + 1, ...report, joinUrl: joinUrl(report.jobId) }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ placeId: fmWorker.PLACE_ID, results }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => console.log(`Health server listening on port ${PORT}`));

client.once('ready', () => {
  console.log(`${client.user.tag} is online!`);
  console.log(`Default prefix: ${PREFIX}`);
  console.log(`FM source: ${fmWorker.FM_SOURCE_URL}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;
  const parts = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = (parts.shift() || '').toLowerCase();
  const subcommand = (parts.shift() || '').toLowerCase();

  if (command === 'ping') {
    await message.reply('pong');
    return;
  }

  if (command === 'find' && subcommand === 'fm') {
    const searching = await message.reply({ content: '🌕 **Searching for Full Moon servers...**\n🔎 Scanning live Blox Fruits servers and collecting every verified FM result I can find...' });
    const deadline = Date.now() + FIND_TIMEOUT_MS;
    let firstFoundAt = null;
    let servers = [];

    while (Date.now() < deadline) {
      await fmWorker.scanOnce();
      servers = freshFullMoonServers();

      if (servers.length && firstFoundAt === null) {
        firstFoundAt = Date.now();
      }

      // Once at least one server is found, keep scanning for a collection window
      // so additional verified FM servers can be returned instead of stopping at #1.
      if (firstFoundAt !== null && Date.now() - firstFoundAt >= COLLECT_AFTER_FIRST_MS) break;

      const wait = Math.min(FIND_INTERVAL_MS, Math.max(0, deadline - Date.now()));
      if (!wait) break;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }

    servers = freshFullMoonServers();
    if (!servers.length) {
      const errorHint = fmWorker.state.lastError ? `\n\n⚠️ Scanner: ${fmWorker.state.lastError}` : '';
      await searching.edit({ content: `🌕 **No verified Full Moon server was found yet.**\n\nI searched continuously for up to ${Math.round(FIND_TIMEOUT_MS / 1000)} seconds. Run \`.find fm\` again to start another search.${errorHint}`, components: [] });
      return;
    }

    await searching.edit(buildResultMessage(servers));
  }
});

client.login(token).catch((error) => {
  console.error('Discord login failed:', error);
  process.exit(1);
});
