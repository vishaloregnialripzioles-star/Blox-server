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

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      bot: client.isReady() ? 'online' : 'starting',
      fmWorker: {
        lastScanAt: fmWorker.state.lastScanAt,
        serversTracked: fmWorker.state.servers.size,
        verifiedFullMoonServers: fmWorker.state.fullMoonReports.size,
        lastError: fmWorker.state.lastError,
      },
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Health server listening on port ${PORT}`);
});

function getFreshFullMoonServer() {
  const cutoff = Date.now() - 2 * 60 * 1000;
  for (const report of fmWorker.state.fullMoonReports.values()) {
    if (report.reportedAt >= cutoff) return report;
  }
  return null;
}

client.once('ready', () => {
  console.log(`${client.user.tag} is online!`);
  console.log(`Default prefix: ${PREFIX}`);
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
      content: '🌕 **Searching for a verified Full Moon server...**\n🔎 Scanning Blox Fruits public servers...',
    });

    const serverFound = getFreshFullMoonServer();

    if (!serverFound) {
      await searching.edit({
        content: '🌕 **No verified Full Moon server found yet.**\n\nThe worker is still scanning. Try `.find fm` again after a verified observer reports a Full Moon.',
      });
      return;
    }

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
