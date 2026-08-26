# Blox Fruits Full Moon Finder

A Discord bot for finding verified Full Moon servers in Blox Fruits. Type .find fm and the bot scans the latest Roblox server data, then replies with one-click Join buttons for confirmed Full Moon servers.

## Discord command

- .find fm - scans for recent verified Full Moon servers and posts Join buttons.
- .ping - health check for the bot.

The Discord application must have Message Content Intent enabled in the Developer Portal. The bot also needs permission to read and send messages in the command channel.

## Render environment variables

Required:

- DISCORD_BOT_TOKEN - the Discord bot token.
- FM_REPORT_SECRET - a long random secret used by the Full Moon observer.

Optional:

- FM_SOURCE_URL - external Full Moon source URL. Defaults to the configured source in fm-worker.js.
- FM_POLL_MS - worker polling interval; defaults to 60 seconds.
- FM_FIND_TIMEOUT_MS - how long .find fm waits; defaults to 90 seconds.
- FM_FIND_INTERVAL_MS - scan interval while a command is waiting; defaults to 7.5 seconds.
- FM_SERVER_PAGES - Roblox public-server pages to inspect; defaults to 2.

The service listens on Render PORT and can use node index.js as its start command or the included npm start script.

## Observer endpoint

The bot accepts verified observer reports at POST /observer/fm.

Send the shared secret in the x-fm-secret header and a JSON body such as:

    {
      "jobId": "roblox-server-job-id",
      "playing": 8,
      "maxPlayers": 12,
      "reportedAt": 1787740800000
    }

Reports older than two minutes are rejected and stale servers automatically disappear. The bot only offers a Roblox game-instance Join URL for recently verified reports.

## Health endpoints

- GET /health - bot and worker status.
- GET /fm - current verified Full Moon results, including Join URLs.