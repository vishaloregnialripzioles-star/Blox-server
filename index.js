const { Client, GatewayIntentBits } = require('discord.js');

const PREFIX = '.';
const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.error('Missing DISCORD_BOT_TOKEN environment variable.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once('ready', () => {
  console.log(`${client.user.tag} is online!`);
  console.log(`Default prefix: ${PREFIX}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const command = message.content.slice(PREFIX.length).trim().split(/\s+/)[0].toLowerCase();

  if (command === 'ping') {
    await message.reply('pong');
  }
});

client.login(token);
