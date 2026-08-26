const http = require('http');
const crypto = require('crypto');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fmWorker = require('./fm-worker');

const PREFIX = '.';
const PORT = Number(process.env.PORT) || 10000;
const token = process.env.DISCORD_BOT_TOKEN;
const REPORT_SECRET = process.env.FM_REPORT_SECRET || '';
const REPORT_MAX_AGE_MS = 2 * 60 * 1000;
const FIND_INTERVAL_MS = Math.max(5000, Number(process.env.FM_FIND_INTERVAL_MS) || 7500);
const ABOUT_TO_FULL_MOON_MINUTES = Math.max(0, Number(process.env.FM_ABOUT_TO_FULL_MOON_MINUTES) || 10);

if (!token) { console.error('Missing DISCORD_BOT_TOKEN environment variable.'); process.exit(1); }
if (!REPORT_SECRET) console.warn('FM_REPORT_SECRET is not set; /observer/fm will reject reports.');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

function freshFullMoonServers() {
  const cutoff = Date.now() - REPORT_MAX_AGE_MS;
  return [...fmWorker.state.fullMoonReports.values()].filter(r => r.reportedAt >= cutoff).sort((a,b) => (Number(b.playing)||0)-(Number(a.playing)||0) || b.reportedAt-a.reportedAt);
}
function joinUrl(jobId) { return `https://www.roblox.com/games/start?placeId=${fmWorker.PLACE_ID}&gameInstanceId=${encodeURIComponent(jobId)}`; }
function buildResultMessage(servers) {
  const lines=['🌕 **Full Moon / Soon Servers Found**','','🎮 **Blox Fruits**','']; const rows=[];
  servers.slice(0,25).forEach((s,i)=>{ lines.push(`**${i+1}.** 👥 ${Number.isFinite(Number(s.playing)) ? `${s.playing}/${s.maxPlayers ?? '?'}` : 'players unavailable'}`); const ri=Math.floor(i/5); if(!rows[ri]) rows[ri]=new ActionRowBuilder(); rows[ri].addComponents(new ButtonBuilder().setLabel(`Join #${i+1}`).setStyle(ButtonStyle.Link).setURL(joinUrl(s.jobId))); });
  if(servers.length>25) lines.push('',`📋 Showing 25 of ${servers.length} verified servers. Run \`.find fm\` again for a fresh list.`);
  lines.push('','✅ Verified by an FM observer.'); return {content:lines.join('\n'),components:rows};
}
function timingSafeEqual(a,b){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);}
function readBody(req){return new Promise((resolve,reject)=>{let body='';req.on('data',c=>{body+=c;if(body.length>10000){req.destroy();reject(new Error('body too large'));}});req.on('end',()=>resolve(body));req.on('error',reject);});}

const server=http.createServer(async(req,res)=>{
  if(req.url==='/'||req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'ok',bot:client.isReady()?'online':'starting',prefix:PREFIX,fmWorker:{lastScanAt:fmWorker.state.lastScanAt,lastSourceAt:fmWorker.state.lastSourceAt,lastSourceStatus:fmWorker.state.lastSourceStatus,serversTracked:fmWorker.state.servers.size,verifiedFullMoonServers:freshFullMoonServers().length,lastError:fmWorker.state.lastError}}));return;}
  if(req.method==='GET'&&req.url==='/fm'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({placeId:fmWorker.PLACE_ID,results:freshFullMoonServers().map((r,i)=>({rank:i+1,...r,joinUrl:joinUrl(r.jobId)}))}));return;}
  if(req.method==='POST'&&req.url==='/observer/fm'){
    try{
      const provided=req.headers['x-fm-secret']; if(!REPORT_SECRET||typeof provided!=='string'||!timingSafeEqual(provided,REPORT_SECRET)){res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'unauthorized'}));return;}
      const body=JSON.parse(await readBody(req));
      const jobId=String(body.jobId||'').trim();
      const reportedAt=Number(body.reportedAt||Date.now());
      const minutesUntilFullMoon=Number(body.minutesUntilFullMoon);
      const fullMoon=body.fullMoon===true||body.isFullMoon===true;
      const aboutToFullMoon=Number.isFinite(minutesUntilFullMoon)&&minutesUntilFullMoon>=0&&minutesUntilFullMoon<=ABOUT_TO_FULL_MOON_MINUTES;
      if(!/^[0-9a-f-]{20,64}$/i.test(jobId)||!Number.isFinite(reportedAt)||Math.abs(Date.now()-reportedAt)>REPORT_MAX_AGE_MS){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'invalid or stale report'}));return;}
      if(!fullMoon&&!aboutToFullMoon){res.writeHead(202,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,ignored:true,reason:'not full moon or within upcoming window'}));return;}
      fmWorker.state.fullMoonReports.set(jobId,{jobId,fullMoon,aboutToFullMoon,minutesUntilFullMoon:Number.isFinite(minutesUntilFullMoon)?minutesUntilFullMoon:null,playing:Number.isFinite(Number(body.playing))?Number(body.playing):null,maxPlayers:Number.isFinite(Number(body.maxPlayers))?Number(body.maxPlayers):12,reportedAt,source:'observer'});
      res.writeHead(202,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,jobId,fullMoon,aboutToFullMoon,joinUrl:joinUrl(jobId)}));
    }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'invalid request'}));} return;
  }
  res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Not found'}));
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Health server listening on port ${PORT}`));
client.once('ready',()=>{console.log(`${client.user.tag} is online!`);console.log(`Default prefix: ${PREFIX}`);});
client.on('messageCreate',async message=>{
  if(message.author.bot||!message.content.startsWith(PREFIX))return;
  const parts=message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command=(parts.shift()||'').toLowerCase();
  const subcommand=(parts.shift()||'').toLowerCase();
  if(command==='ping'){await message.reply('pong');return;}
  if(command==='find'&&subcommand==='fm'){
    const searching=await message.reply({content:'Searching until a Full Moon or soon-to-be-Full-Moon server is verified...'});
    while(true){
      let servers=[];
      try{await fmWorker.scanOnce();servers=freshFullMoonServers();}
      catch(e){console.error('Full Moon scan failed:',e);}
      if(servers.length){await searching.edit(buildResultMessage(servers));return;}
      await new Promise(r=>setTimeout(r,FIND_INTERVAL_MS));
    }
  }
});
client.login(token).catch(e=>{console.error('Discord login failed:',e);process.exit(1);});
