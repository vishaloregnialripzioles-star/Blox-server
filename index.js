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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function freshFullMoonServers() {
  const cutoff = Date.now() - 2 * 60 * 1000;
  return [...fmWorker.state.fullMoonReports.values()]
    .filter((report) => report.reportedAt >= cutoff)
    .sort((a, b) => b.reportedAt - a.reportedAt);
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
    const results = freshFullMoonServers().map((report) => ({
      ...report,
      joinUrl: `https://www.roblox.com/games/start?placeId=${fmWorker.PLACE_ID}&gameInstanceId=${encodeURIComponent(report.jobId)}`,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ placeId: fmWorker.PLACE_ID, results }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Health server listening on port ${PORT}`);
});

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
    const searching = await message.reply({
      content: '🌕 **Searching for a Full Moon server...**\n🔎 Checking Blox Fruits server data...',
    });

    // Trigger an immediate scan instead of making the user wait for the next interval.
    await fmWorker.scanOnce();
    const servers = freshFullMoonServers();

    if (!servers.length) {
      await searching.edit({
        content: '🌕 **No Full Moon server is currently verified by the configured scanner.**\n\nTry again in a few seconds. The scanner automatically keeps checking.',
        components: [],
      });
      return;
    }

    const serverFound = servers[0];
    const joinUrl = `https://www.roblox.com/games/start?placeId=${fmWorker.PLACE_ID}&gameInstanceId=${encodeURIComponent(serverFound.jobId)}`;
    const players = `${serverFound.playing}/${serverFound.maxPlayers}`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Join Server')
        .setStyle(ButtonStyle.Link)
        .setURL(joinUrl)
    );

    await searching.edit({
      content: `🌕 **Full Moon Server Found!**\n\n🎮 **Blox Fruits**\n👥 **Players:** ${players}\n🆔 **Server:** \`${serverFound.jobId}\``,
      components: [row],
    });
  }
});

client.login(token).catch((error) => {
  console.error('Discord login failed:', error);
  process.exit(1);
});
