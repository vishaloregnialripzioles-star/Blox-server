const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fmWorker = require('./fm-worker');

const PREFIX = '.';
const PORT = Number(process.env.PORT) || 10000;
const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.error('Missing DISCORD_BOT_TOKEN environment variable.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

function freshFullMoonServers() {
  const cutoff = Date.now() - 2 * 60 * 1000;
  return [...fmWorker.state.fullMoonReports.values()]
    .filter((report) => report.reportedAt >= cutoff)
    .sort((a, b) => (b.playing - a.playing) || (b.reportedAt - a.reportedAt))
    .slice(0, 10);
}

function joinUrl(jobId) {
  return `https://www.roblox.com/games/start?placeId=${fmWorker.PLACE_ID}&gameInstanceId=${encodeURIComponent(jobId)}`;
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      bot: client.isReady() ? 'online' : 'starting',
      prefix: PREFIX,
      fmWorker: {
        source: fmWorker.FM_SOURCE_URL,
        lastScanAt: fmWorker.state.lastScanAt,
        lastSourceAt: fmWorker.state.lastSourceAt,
        lastSourceStatus: fmWorker.state.lastSourceStatus,
        serversTracked: fmWorker.state.servers.size,
        verifiedFullMoonServers: freshFullMoonServers().length,
        lastError: fmWorker.state.lastError,
      },
    }));
    return;
  }

  if (req.method === 'GET' && req.url === '/fm') {
    const results = freshFullMoonServers().map((report, index) => ({
      rank: index + 1,
      ...report,
      joinUrl: joinUrl(report.jobId),
    }));
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
    const searching = await message.reply({ content: '🌕 **Searching for Full Moon servers...**\n🔎 Checking live Blox Fruits server data...' });
    await fmWorker.scanOnce();
    const servers = freshFullMoonServers();

    if (!servers.length) {
      await searching.edit({ content: '🌕 **No currently verified Full Moon servers were returned.**\n\nThe scanner keeps checking automatically. Try `.find fm` again shortly.', components: [] });
      return;
    }

    const lines = ['🌕 **Top Full Moon Servers**', '', '🎮 **Blox Fruits**', ''];
    const rows = [];

    servers.forEach((s, i) => {
      lines.push(`**${i + 1}.** 👥 ${s.playing}/${s.maxPlayers}`);
      const rowIndex = Math.floor(i / 5);
      if (!rows[rowIndex]) rows[rowIndex] = new ActionRowBuilder();
      rows[rowIndex].addComponents(
        new ButtonBuilder().setLabel(`Join #${i + 1}`).setStyle(ButtonStyle.Link).setURL(joinUrl(s.jobId))
      );
    });

    lines.push('', '⏱️ Results are based on the latest verified FM reports and expire after 2 minutes.');
    await searching.edit({ content: lines.join('\n'), components: rows });
  }
});

client.login(token).catch((error) => {
  console.error('Discord login failed:', error);
  process.exit(1);
});
