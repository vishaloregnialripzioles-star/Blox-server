const http = require('http');
const { Client, GatewayIntentBits } = require('discord.js');

const PREFIX = '.';
const PORT = Number(process.env.PORT) || 10000;
const token = process.env.DISCORD_BOT_TOKEN;

// Render Web Service health server.
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', bot: client?.isReady() ? 'online' : 'starting' }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Health server listening on port ${PORT}`);
});

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

client.once('ready', () => {
  console.log(`${client.user.tag} is online!`);
  console.log(`Default prefix: ${PREFIX}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const command = message.content
    .slice(PREFIX.length)
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();

  if (command === 'ping') {
    await message.reply('pong');
  }
});

client.login(token).catch((error) => {
  console.error('Discord login failed:', error);
  process.exit(1);
});
