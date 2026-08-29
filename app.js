mport express from 'express';
import session from 'express-session';
import crypto from 'node:crypto';
import pg from 'pg';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://blox-server.onrender.com').replace(/\/$/, '');
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const DATABASE_URL = process.env.DATABASE_URL || '';
const REDIRECT_URI = `${PUBLIC_URL}/oauth/callback`;
const BOT_CLIENT_ID = process.env.DISCORD_BOT_CLIENT_ID || '1530577031753105409';

let pool = null;
if (DATABASE_URL) {
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });
  await pool.query(`
    create table if not exists sparxie_forms (
      id text primary key,
      guild_id text not null,
      name text not null,
      slug text not null unique,
      form_type text not null,
      description text not null default '',
      questions jsonb not null default '[]',
      reviewer_users jsonb not null default '[]',
      reviewer_roles jsonb not null default '[]',
      enabled boolean not null default true,
      created_by text not null,
      created_at timestamptz not null default now()
    );
    create table if not exists sparxie_form_submissions (
      id text primary key,
      form_id text not null references sparxie_forms(id) on delete cascade,
      user_id text not null,
      username text not null,
      answers jsonb not null default '{}',
      status text not null default 'pending',
      reviewer_id text,
      reviewer_name text,
      review_note text,
      created_at timestamptz not null default now(),
      reviewed_at timestamptz
    );
    create index if not exists sparxie_forms_guild_idx on sparxie_forms(guild_id);
    create index if not exists sparxie_submissions_form_idx on sparxie_form_submissions(form_id);
  `);
}

const memory = { forms: [], submissions: [] };
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: PUBLIC_URL.startsWith('https://'), sameSite: 'lax', httpOnly: true, maxAge: 604800000 }
}));

const esc = (v = '') => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const values = v => Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v]);
const arr = v => Array.isArray(v) ? v : [];
const slugify = v => String(v || 'form').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'form';
const isManager = g => { try { return !!g?.owner || (BigInt(g?.permissions || '0') & 0x8n) !== 0n || (BigInt(g?.permissions || '0') & 0x20n) !== 0n; } catch { return false; } };
const parseCsv = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 100);
const safeNext = v => { const s = String(v || '/dashboard'); return s.startsWith('/') && !s.startsWith('//') ? s : '/dashboard'; };

const defaults = {
  staff: [
    { title:'Age', text:'How old are you?', type:'short' },
    { title:'Timezone', text:'What is your timezone?', type:'short' },
    { title:'Experience', text:'Tell us about your staff or moderation experience.', type:'long' },
    { title:'Activity', text:'How active can you be each day?', type:'short' },
    { title:'Why should we choose you?', text:'Tell us why you would be a good staff member.', type:'long' }
  ],
  appeal: [
    { title:'Discord User ID', text:'What is your Discord user ID?', type:'short' },
    { title:'What happened?', text:'Explain what happened and why you were punished.', type:'long' },
    { title:'Why should the appeal be accepted?', text:'Be honest and detailed.', type:'long' }
  ],
  partnership: [
    { title:'Server / Project', text:'What server or project are you representing?', type:'short' },
    { title:'Audience', text:'How many members or followers do you have?', type:'short' },
    { title:'Proposal', text:'Explain your partnership proposal.', type:'long' }
  ],
  report: [
    { title:'User or issue', text:'Who or what are you reporting?', type:'short' },
    { title:'Details', text:'Describe the issue in detail.', type:'long' },
    { title:'Evidence', text:'Provide evidence or links if available.', type:'long' }
  ],
  custom: [{ title:'Question 1', text:'Write your question here.', type:'long' }]
};

function page(req, title, body) {
  const header = req.session.user ? '<a class="btn alt" href="/dashboard">Dashboard</a> <a class="btn" href="/logout">Logout</a>' : '<a class="btn" href="/login">Login with Discord</a>';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><style>' +
`:root{--card:#1b2029;--card2:#252b36;--line:#363d4b;--pink:#d52d58;--pink2:#a91e43;--text:#f5f7fb;--muted:#a5adbb;--green:#4ed69d;--red:#ff7180;--yellow:#f3c85b}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 70% 0,#252b40,#0f1117 48%);color:var(--text);font:15px system-ui,-apple-system,Segoe UI,sans-serif}a{text-decoration:none;color:inherit}.top{height:68px;padding:0 5%;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:#0f1117ee;position:sticky;top:0;z-index:20}.brand{font-size:21px;font-weight:900}.brand b{color:var(--pink)}.wrap{width:min(1120px,92%);margin:28px auto 70px}.card{background:linear-gradient(145deg,#1d222c,#171a21);border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:0 14px 40px #0004}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:10px;padding:11px 16px;background:linear-gradient(135deg,var(--pink),var(--pink2));color:#fff;font-weight:800;cursor:pointer}.alt{background:#303746}.danger{background:#8d3345}.muted{color:var(--muted)}.small{font-size:12px}.hero{text-align:center;padding:55px 20px}.hero h1{font-size:clamp(38px,7vw,68px);line-height:1;margin:12px 0}.field{display:grid;gap:7px;margin:14px 0}.field label{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.1em}.input,.textarea,.select{width:100%;background:var(--card2);color:#fff;border:1px solid #424a59;border-radius:10px;padding:12px;font:inherit}.textarea{min-height:110px;resize:vertical}.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 0;border-bottom:1px solid var(--line)}.pill{display:inline-block;padding:5px 9px;border-radius:999px;background:#303746;color:#d5dae3;font-size:12px}.status{font-weight:800}.pending{color:var(--yellow)}.approved{color:var(--green)}.denied{color:var(--red)}.question{background:#14171e;border:1px solid var(--line);border-radius:12px;padding:15px;margin:12px 0}.server{display:flex;align-items:center;justify-content:space-between;gap:15px}.server-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.empty{text-align:center;padding:40px;color:var(--muted)}.qrow{display:grid;grid-template-columns:1fr 1fr 120px 110px;gap:8px;align-items:end}.actions{display:flex;gap:8px;flex-wrap:wrap}.list{display:grid;gap:12px}.copy{word-break:break-all;color:#ff7196}@media(max-width:800px){.grid,.qrow{grid-template-columns:1fr}.server{align-items:flex-start;flex-direction:column}.server-actions{width:100%;justify-content:flex-start}.top{padding:0 15px}.hero{padding:35px 10px}}` +
'</style></head><body><header class="top"><a class="brand" href="/">Sparxie <b>Forms</b></a><div>' + header + '</div></header>' + body + '</body></html>';
}

function manageable(req) { return arr(req.session.guilds).filter(isManager); }
async function discord(path, token) {
  const r = await fetch('https://discord.com/api/v10' + path, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('Discord API ' + r.status);
  return r.json();
}
async function botGuilds() {
  if (!BOT_TOKEN) return new Set();
  try {
    const r = await fetch('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: 'Bot ' + BOT_TOKEN } });
    if (!r.ok) return new Set();
    return new Set((await r.json()).map(g => g.id));
  } catch { return new Set(); }
}
async function allForms(gid) { if (!pool) return memory.forms.filter(x => x.guild_id === gid); return (await pool.query('select * from sparxie_forms where guild_id=$1 order by created_at desc',[gid])).rows; }
async function getForm(id) { if (!pool) return memory.forms.find(x => x.id === id); return (await pool.query('select * from sparxie_forms where id=$1',[id])).rows[0]; }
async function getSlug(slug) { if (!pool) return memory.forms.find(x => x.slug === slug && x.enabled); return (await pool.query('select * from sparxie_forms where slug=$1 and enabled=true',[slug])).rows[0]; }
async function createForm(f) { if (!pool) { memory.forms.push(f); return; } await pool.query('insert into sparxie_forms(id,guild_id,name,slug,form_type,description,questions,reviewer_users,reviewer_roles,enabled,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[f.id,f.guild_id,f.name,f.slug,f.form_type,f.description,JSON.stringify(f.questions),JSON.stringify(f.reviewer_users),JSON.stringify(f.reviewer_roles),f.enabled,f.created_by]); }
async function updateForm(id,f) { if (!pool) { const old=await getForm(id); if(old)Object.assign(old,f); return old; } await pool.query('update sparxie_forms set name=$2,slug=$3,form_type=$4,description=$5,questions=$6,reviewer_users=$7,reviewer_roles=$8,enabled=$9 where id=$1',[id,f.name,f.slug,f.form_type,f.description,JSON.stringify(f.questions),JSON.stringify(f.reviewer_users),JSON.stringify(f.reviewer_roles),f.enabled]); return getForm(id); }
async function submissions(fid) { if (!pool) return memory.submissions.filter(x=>x.form_id===fid); return (await pool.query('select * from sparxie_form_submissions where form_id=$1 order by created_at desc',[fid])).rows; }
async function getSubmission(id) { if (!pool) return memory.submissions.find(x=>x.id===id); return (await pool.query('select * from sparxie_form_submissions where id=$1',[id])).rows[0]; }
async function createSubmission(s) { if (!pool) { memory.submissions.unshift(s); return; } await pool.query('insert into sparxie_form_submissions(id,form_id,user_id,username,answers) values($1,$2,$3,$4,$5)',[s.id,s.form_id,s.user_id,s.username,JSON.stringify(s.answers)]); }
async function reviewAllowed(req,form) { if(!form||!req.session.user)return false; if(form.created_by===req.session.user.id)return true; if(arr(form.reviewer_users).includes(req.session.user.id))return true; if(!BOT_TOKEN||!arr(form.reviewer_roles).length)return false; try { const r=await fetch('https://discord.com/api/v10/guilds/'+form.guild_id+'/members/'+req.session.user.id,{headers:{Authorization:'Bot '+BOT_TOKEN}}); if(!r.ok)return false; const m=await r.json(); return arr(form.reviewer_roles).some(role=>arr(m.roles).includes(role)); } catch { return false; } }
function auth(req,res,next) { if(!req.session.user)return res.redirect('/login?next='+encodeURIComponent(req.originalUrl)); next(); }
function parseQuestions(body) {
  const titles = values(body.q_title), texts = values(body.q_text), types = values(body.q_type);
  const out = [];
  const count = Math.max(titles.length, texts.length, types.length);
  for (let i = 0; i < count; i++) {
    const title = String(titles[i] ?? '').trim().slice(0, 200);
    const text = String(texts[i] ?? '').trim().slice(0, 1000);
    const type = ['short', 'long', 'number'].includes(String(types[i] ?? '')) ? String(types[i]) : 'short';
    if (title && text) out.push({ title, text, type });
  }
  return out;
}

app.get('/',(req,res)=>res.send(page(req,'Sparxie Forms','<main class="wrap"><section class="card hero"><div class="muted">DISCORD FORMS</div><h1>Staff applications.<br><b style="color:var(--pink)">Made simple.</b></h1><p class="muted">Create Staff Applications, Appeals, Reports, Partnerships and custom forms. Choose exactly who can review submissions.</p><a class="btn" href="'+(req.session.user?'/dashboard':'/login')+'">'+(req.session.user?'Open Dashboard':'Login with Discord')+'</a></section></main>')));

app.get('/login',(req,res)=>{if(!CLIENT_ID||!CLIENT_SECRET)return res.status(500).send('Missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET in Render environment variables.');const state=crypto.randomUUID();req.session.oauthState=state;req.session.afterLogin=safeNext(req.query.next);const q=new URLSearchParams({client_id:CLIENT_ID,response_type:'code',redirect_uri:REDIRECT_URI,scope:'identify guilds',state});res.redirect('https://discord.com/oauth2/authorize?'+q.toString());});

app.get('/oauth/callback',async(req,res)=>{try{const code=String(req.query.code||''),state=String(req.query.state||'');if(!code||!state||state!==req.session.oauthState)return res.status(400).send('OAuth state validation failed. Please start login again.');const tokenRes=await fetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:CLIENT_ID,client_secret:CLIENT_SECRET,grant_type:'authorization_code',code,redirect_uri:REDIRECT_URI})});if(!tokenRes.ok){const errorText=await tokenRes.text();console.error('[OAuth] Discord token exchange failed:',tokenRes.status,errorText);return res.status(502).send('Discord OAuth failed ('+tokenRes.status+'): '+esc(errorText));}const token=await tokenRes.json();const user=await discord('/users/@me',token.access_token);const guilds=await discord('/users/@me/guilds',token.access_token);req.session.user=user;req.session.guilds=guilds;delete req.session.oauthState;const next=req.session.afterLogin||'/dashboard';delete req.session.afterLogin;res.redirect(next);}catch(e){console.error('[OAuth]',e);res.status(500).send('Login failed: '+esc(e.message));}});
app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/')));

app.get('/dashboard',auth,async(req,res)=>{const managed=manageable(req),bots=await botGuilds();const cards=managed.map(g=>{const present=bots.has(g.id),add='https://discord.com/oauth2/authorize?client_id='+encodeURIComponent(BOT_CLIENT_ID)+'&permissions=8&integration_type=0&scope=bot&guild_id='+encodeURIComponent(g.id),action=present?'<a class="btn" href="/server/'+encodeURIComponent(g.id)+'">Go to server</a>':'<a class="btn" href="'+add+'">Add bot</a>';return '<div class="card"><div class="server"><div><h3 style="margin:0 0 5px">'+esc(g.name)+'</h3><div class="muted small">'+esc(g.id)+'</div><p>'+(present?'<span class="pill">✅ Sparxie is installed</span>':'<span class="pill">⚠️ Bot not installed</span>')+'</p></div><div class="server-actions">'+action+'</div></div></div>';}).join('');res.send(page(req,'Select Server','<main class="wrap"><div class="hero"><h1>Select a server</h1><p class="muted">Only servers you manage are shown.</p></div><div class="list">'+(cards||'<div class="card empty">No manageable servers found.</div>')+'</div></main>'));});

app.get('/server/:guildId',auth,async(req,res)=>{const g=manageable(req).find(x=>x.id===req.params.guildId);if(!g)return res.status(403).send('You do not manage this server.');const bots=await botGuilds();if(!bots.has(g.id)&&BOT_TOKEN)return res.redirect('/dashboard');const formsList=await allForms(g.id);const cards=formsList.map(f=>'<div class="card"><div class="row"><div><h3 style="margin:0">'+esc(f.name)+'</h3><div class="muted small">/'+esc(f.slug)+' · '+esc(f.form_type)+'</div></div><span class="pill">'+(f.enabled?'Enabled':'Disabled')+'</span></div><p class="muted">'+esc(f.description)+'</p><div class="actions"><a class="btn" href="/server/'+encodeURIComponent(g.id)+'/forms/'+encodeURIComponent(f.id)+'">Manage</a><a class="btn alt" href="/f/'+encodeURIComponent(f.slug)+'" target="_blank">Open Form</a></div></div>').join('');res.send(page(req,g.name+' Forms','<main class="wrap"><div class="hero"><h1>'+esc(g.name)+'</h1><p class="muted">Create forms and review member submissions.</p><a class="btn" href="/server/'+encodeURIComponent(g.id)+'/forms/new">＋ Create Form</a></div><div class="list">'+(cards||'<div class="card empty">No forms yet.</div>')+'</div></main>'));});

app.get('/server/:guildId/forms/new',auth,(req,res)=>{const g=manageable(req).find(x=>x.id===req.params.guildId);if(!g)return res.status(403).send('Forbidden');const typeOptions=['staff:Staff Application','appeal:Appeal','partnership:Partnership','report:Report','custom:Custom Form'].map(x=>{const [v,l]=x.split(':');return '<option value="'+v+'">'+l+'</option>';}).join('');const defsJson=JSON.stringify(defaults).replace(/</g,'\\u003c');const body='<main class="wrap"><div class="hero"><h1>Create a form</h1><p class="muted">Choose a type, customize questions and reviewers, then save it to receive a public link.</p></div><form method="post" action="/server/'+encodeURIComponent(g.id)+'/forms/create"><div class="card"><div class="grid"><div class="field"><label>Form name</label><input class="input" name="name" required placeholder="Staff Application"></div><div class="field"><label>Type</label><select class="select" name="form_type" id="formType" onchange="loadDefaults()">'+typeOptions+'</select></div></div><div class="field"><label>Description</label><textarea class="textarea" name="description"></textarea></div><div class="row"><div><h3 style="margin:0">Questions</h3><div class="muted small">Unlimited questions — add as many as you need.</div></div></div><div id="questions"></div><button type="button" class="btn alt" onclick="addQ()">＋ Add Question</button><div class="grid" style="margin-top:20px"><div class="field"><label>Reviewer User IDs</label><input class="input" name="reviewer_users" placeholder="Discord user IDs, comma separated"></div><div class="field"><label>Reviewer Role IDs</label><input class="input" name="reviewer_roles" placeholder="Discord role IDs, comma separated"></div></div><div class="actions"><button class="btn" type="submit">Save Form</button><a class="btn alt" href="/server/'+encodeURIComponent(g.id)+'">Cancel</a></div></div></form></main><script>const defs='+defsJson+';let qs=[];function escA(s){return String(s??"").replace(/[&<>"\']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","\'":"&#39;"}[c]))}function loadDefaults(){if(!qs.length){qs=(defs[document.getElementById("formType").value]||[]).map(x=>({...x}));}render()}function addQ(){qs.push({title:"",text:"",type:"short"});render()}function render(){document.getElementById("questions").innerHTML=qs.map((q,i)=>"<div class=\"question\"><div class=\"qrow\"><div class=\"field\"><label>Title</label><input class=\"input\" name=\"q_title\" value=\""+escA(q.title)+"\"></div><div class=\"field\"><label>Question</label><input class=\"input\" name=\"q_text\" value=\""+escA(q.text)+"\"></div><div class=\"field\"><label>Answer</label><select class=\"select\" name=\"q_type\"><option value=\"short\" "+(q.type==="short"?"selected":"")+">Short text</option><option value=\"long\" "+(q.type==="long"?"selected":"")+">Long text</option><option value=\"number\" "+(q.type==="number"?"selected":"")+">Number</option></select></div><button type=\"button\" class=\"btn danger\" onclick=\"qs.splice("+i+",1);render()\">Remove</button></div></div>").join("")}loadDefaults();</script>';res.send(page(req,'Create Form',body));});

app.post('/server/:guildId/forms/create',auth,async(req,res)=>{const g=manageable(req).find(x=>x.id===req.params.guildId);if(!g)return res.status(403).send('Forbidden');let slug=slugify(req.body.name);const duplicate=async()=>pool?(await pool.query('select id from sparxie_forms where slug=$1',[slug])).rows.length:memory.forms.some(x=>x.slug===slug);if(await duplicate())slug+='-'+crypto.randomBytes(2).toString('hex');const formType=['staff','appeal','partnership','report','custom'].includes(String(req.body.form_type))?String(req.body.form_type):'custom';const f={id:crypto.randomUUID(),guild_id:g.id,name:String(req.body.name||'Untitled Form').trim().slice(0,100),slug,form_type:formType,description:String(req.body.description||'').slice(0,1000),questions:parseQuestions(req.body),reviewer_users:parseCsv(req.body.reviewer_users),reviewer_roles:parseCsv(req.body.reviewer_roles),enabled:true,created_by:req.session.user.id,created_at:new Date().toISOString()};if(!f.questions.length)f.questions=defaults[f.form_type]||defaults.custom;await createForm(f);res.redirect('/server/'+encodeURIComponent(g.id)+'/forms/'+encodeURIComponent(f.id));});

app.get('/server/:guildId/forms/:formId',auth,async(req,res)=>{const g=manageable(req).find(x=>x.id===req.params.guildId);if(!g)return res.status(403).send('Forbidden');const f=await getForm(req.params.formId);if(!f||f.guild_id!==g.id)return res.status(404).send('Form not found');const subs=await submissions(f.id);const questions=arr(f.questions).map((q,i)=>'<div class="question"><div class="qrow"><div class="field"><label>Title</label><input class="input" name="q_title" value="'+esc(q.title)+'"></div><div class="field"><label>Question</label><input class="input" name="q_text" value="'+esc(q.text)+'"></div><div class="field"><label>Answer</label><select class="select" name="q_type"><option value="short" '+(q.type==='short'?'selected':'')+'>Short</option><option value="long" '+(q.type==='long'?'selected':'')+'>Long</option><option value="number" '+(q.type==='number'?'selected':'')+'>Number</option></select></div><div class="muted small">Question '+(i+1)+'</div></div></div>').join('');const subCards=subs.map(s=>'<div class="card"><div class="row"><div><b>'+esc(s.username)+'</b><div class="muted small">'+esc(s.user_id)+' · '+esc(new Date(s.created_at).toLocaleString())+'</div></div><span class="status '+esc(s.status)+'">'+esc(s.status)+'</span></div><div class="actions"><a class="btn" href="/server/'+encodeURIComponent(g.id)+'/forms/'+encodeURIComponent(f.id)+'/submissions/'+encodeURIComponent(s.id)+'">Review</a></div></div>').join('');const body='<main class="wrap"><div class="hero"><h1>'+esc(f.name)+'</h1><p class="muted">Public link:</p><div class="copy">'+esc(PUBLIC_URL+'/f/'+f.slug)+'</div></div><div class="card"><form method="post" action="/server/'+encodeURIComponent(g.id)+'/forms/'+encodeURIComponent(f.id)+'/settings"><div class="grid"><div class="field"><label>Name</label><input class="input" name="name" value="'+esc(f.name)+'"></div><div class="field"><label>Type</label><select class="select" name="form_type"><option value="staff" '+(f.form_type==='staff'?'selected':'')+'>Staff Application</option><option value="appeal" '+(f.form_type==='appeal'?'selected':'')+'>Appeal</option><option value="partnership" '+(f.form_type==='partnership'?'selected':'')+'>Partnership</option><option value="report" '+(f.form_type==='report'?'selected':'')+'>Report</option><option value="custom" '+(f.form_type==='custom'?'selected':'')+'>Custom</option></select></div></div><div class="field"><label>Description</label><textarea class="textarea" name="description">'+esc(f.description)+'</textarea></div><h3>Questions</h3>'+questions+'<div class="grid"><div class="field"><label>Reviewer User IDs</label><input class="input" name="reviewer_users" value="'+esc(arr(f.reviewer_users).join(', '))+'"></div><div class="field"><label>Reviewer Role IDs</label><input class="input" name="reviewer_roles" value="'+esc(arr(f.reviewer_roles).join(', '))+'"></div></div><div class="field"><label><input type="checkbox" name="enabled" '+(f.enabled?'checked':'')+'> Form enabled</label></div><div class="actions"><button class="btn" type="submit">Save Changes</button><a class="btn alt" href="/server/'+encodeURIComponent(g.id)+'">Back</a></div></form></div><h2 style="margin-top:30px">Submissions ('+subs.length+')</h2><div class="list">'+(subCards||'<div class="card empty">No submissions yet.</div>')+'</div></main>';res.send(page(req,f.name+' · Forms',body));});

app.post('/server/:guildId/forms/:formId/settings',auth,async(req,res)=>{const g=manageable(req).find(x=>x.id===req.params.guildId);if(!g)return res.status(403).send('Forbidden');const f=await getForm(req.params.formId);if(!f||f.guild_id!==g.id)return res.status(404).send('Form not found');let slug=f.slug,requested=slugify(req.body.name);if(requested!==f.slug){const exists=pool?(await pool.query('select id from sparxie_forms where slug=$1 and id<>$2',[requested,f.id])).rows.length:memory.forms.some(x=>x.slug===requested&&x.id!==f.id);if(!exists)slug=requested;}const next={...f,name:String(req.body.name||f.name).trim().slice(0,100),slug,form_type:['staff','appeal','partnership','report','custom'].includes(String(req.body.form_type))?String(req.body.form_type):f.form_type,description:String(req.body.description||'').slice(0,1000),questions:parseQuestions(req.body),reviewer_users:parseCsv(req.body.reviewer_users),reviewer_roles:parseCsv(req.body.reviewer_roles),enabled:req.body.enabled==='on'};if(!next.questions.length)next.questions=f.questions;await updateForm(f.id,next);res.redirect('/server/'+encodeURIComponent(g.id)+'/forms/'+encodeURIComponent(f.id));});

app.get('/server/:guildId/forms/:formId/submissions/:submissionId',auth,async(req,res)=>{const f=await getForm(req.params.formId);if(!f||f.guild_id!==req.params.guildId)return res.status(404).send('Not found');if(!(await reviewAllowed(req,f)))return res.status(403).send('You are not allowed to review this form.');const s=await getSubmission(req.params.submissionId);if(!s||s.form_id!==f.id)return res.status(404).send('Submission not found');const answers=typeof s.answers==='string'?JSON.parse(s.answers):(s.answers||{});const rows=arr(f.questions).map(q=>'<div class="question"><b>'+esc(q.title)+'</b><div class="muted small">'+esc(q.text)+'</div><p>'+esc(answers[q.title]||'No answer')+'</p></div>').join('');const body='<main class="wrap"><div class="hero"><h1>Review submission</h1><p class="muted">'+esc(s.username)+' · '+esc(f.name)+'</p></div><div class="card">'+rows+'<form method="post" action="/server/'+encodeURIComponent(f.guild_id)+'/forms/'+encodeURIComponent(f.id)+'/submissions/'+encodeURIComponent(s.id)+'/review"><div class="field"><label>Decision</label><select class="select" name="status"><option value="pending" '+(s.status==='pending'?'selected':'')+'>Pending</option><option value="approved" '+(s.status==='approved'?'selected':'')+'>Approve</option><option value="denied" '+(s.status==='denied'?'selected':'')+'>Deny</option></select></div><div class="field"><label>Review note</label><textarea class="textarea" name="note">'+esc(s.review_note||'')+'</textarea></div><button class="btn" type="submit">Save Review</button></form></div></main>';res.send(page(req,'Review Submission',body));});

app.post('/server/:guildId/forms/:formId/submissions/:submissionId/review',auth,async(req,res)=>{const f=await getForm(req.params.formId);if(!f||f.guild_id!==req.params.guildId)return res.status(404).send('Not found');if(!(await reviewAllowed(req,f)))return res.status(403).send('Not allowed');const status=['pending','approved','denied'].includes(String(req.body.status))?String(req.body.status):'pending',note=String(req.body.note||'').slice(0,2000);if(pool)await pool.query('update sparxie_form_submissions set status=$2,reviewer_id=$3,reviewer_name=$4,review_note=$5,reviewed_at=now() where id=$1',[req.params.submissionId,status,req.session.user.id,req.session.user.global_name||req.session.user.username||'Reviewer',note]);else{const s=await getSubmission(req.params.submissionId);if(s){s.status=status;s.reviewer_id=req.session.user.id;s.reviewer_name=req.session.user.global_name||req.session.user.username;s.review_note=note;s.reviewed_at=new Date().toISOString();}}res.redirect('/server/'+encodeURIComponent(f.guild_id)+'/forms/'+encodeURIComponent(f.id)+'/submissions/'+encodeURIComponent(req.params.submissionId));});

app.get('/f/:slug',async(req,res)=>{const f=await getSlug(req.params.slug);if(!f)return res.status(404).send(page(req,'Form Not Found','<main class="wrap"><div class="card empty">This form does not exist or is disabled.</div></main>'));if(!req.session.user)return res.send(page(req,f.name,'<main class="wrap"><div class="hero"><h1>'+esc(f.name)+'</h1><p class="muted">'+esc(f.description)+'</p><a class="btn" href="/login?next='+encodeURIComponent(req.originalUrl)+'">Login with Discord to apply</a></div></main>'));const questions=arr(f.questions).map((q,i)=>'<div class="question"><label><b>'+esc(q.title)+'</b><div class="muted small">'+esc(q.text)+'</div><textarea class="textarea" name="answer_'+i+'" '+(q.type==='number'?'inputmode="numeric"':'')+' required></textarea></label></div>').join('');res.send(page(req,f.name,'<main class="wrap"><div class="hero"><h1>'+esc(f.name)+'</h1><p class="muted">'+esc(f.description)+'</p><p class="muted">Submitting as <b>'+esc(req.session.user.global_name||req.session.user.username)+'</b>.</p></div><form method="post" action="/f/'+encodeURIComponent(f.slug)+'/submit"><div class="card">'+questions+'<button class="btn" type="submit">Submit Form</button></div></form></main>'));});

app.post('/f/:slug/submit',auth,async(req,res)=>{const f=await getSlug(req.params.slug);if(!f)return res.status(404).send('Form not found');const answers={};arr(f.questions).forEach((q,i)=>{answers[q.title]=String(req.body['answer_'+i]||'').trim();});if(Object.values(answers).some(v=>!v))return res.status(400).send('Please answer every required question.');await createSubmission({id:crypto.randomUUID(),form_id:f.id,user_id:req.session.user.id,username:req.session.user.global_name||req.session.user.username,answers,created_at:new Date().toISOString()});res.send(page(req,'Submitted','<main class="wrap"><div class="card hero"><h1>✅ Submitted!</h1><p class="muted">Your response for <b>'+esc(f.name)+'</b> has been saved. Staff reviewers can now review it.</p><a class="btn" href="/f/'+encodeURIComponent(f.slug)+'">Back to form</a></div></main>'));});

app.get('/health',(req,res)=>res.json({ok:true,service:'sparxie-forms',database:!!pool,oauth:!!(CLIENT_ID&&CLIENT_SECRET),botToken:!!BOT_TOKEN,publicUrl:PUBLIC_URL,redirectUri:REDIRECT_URI}));
app.listen(PORT,'0.0.0.0',()=>console.log('Sparxie Forms listening on '+PORT));
