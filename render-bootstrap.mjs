import express from 'express';
import fs from 'node:fs';

// Render terminates HTTPS at its proxy and forwards the request to Node over HTTP.
// The existing app uses secure session cookies, so Express must trust that proxy.
const originalDefaultConfiguration = express.application.defaultConfiguration;
express.application.defaultConfiguration = function (...args) {
  const result = originalDefaultConfiguration.apply(this, args);
  this.set('trust proxy', 1);
  return result;
};

// Repair the generated homepage route before Node parses app.js.
// This is intentionally done before the entry module is loaded because the
// broken route currently causes a SyntaxError during startup.
const appPath = new URL('./app.js', import.meta.url);
let source = fs.readFileSync(appPath, 'utf8');
const fixedHomepage = `app.get('/',(req,res)=>res.send(page(req,'Sparxie Forms',
  '<main class="wrap"><section class="card hero"><div class="muted">DISCORD FORMS</div><h1>Staff applications.<br><b style="color:var(--pink)">Made simple.</b></h1><p class="muted">Create Staff Applications, Appeals, Reports, Partnerships and custom forms. Choose exactly who can review submissions.</p><a class="btn" href="'+(req.session.user?'/dashboard':'/login')+'">'+(req.session.user?'Open Dashboard':'Login with Discord')+'</a></section></main>'
)));`;
const pattern = /app\.get\('\/',\(req,res\)=>res\.send\(page\(req,'Sparxie Forms',[\s\S]*?\)\)\);\n\napp\.get\('\/login'/;
if (pattern.test(source)) {
  source = source.replace(pattern, fixedHomepage + "\n\napp.get('/login'");
  fs.writeFileSync(appPath, source);
  console.log('✅ Patched broken Sparxie Forms homepage route before startup.');
}