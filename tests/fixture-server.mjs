// Manual browser regression fixture: node tests/fixture-server.mjs <mode-file>
// Write ready, empty, or error to that file to exercise recovery without local logs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { createDemo } from '../ui/js/demo.js';
const root = fileURLToPath(new URL('../ui/', import.meta.url));
const demo = createDemo();
const modeFile = process.argv[2];
const port = Number(process.env.PORT) || 5179;
if (!modeFile) throw new Error('Pass a mode file containing ready, empty, or error');
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'};
createServer(async (req,res) => {
  if (req.url === '/api/snapshot') {
    const mode = (await readFile(modeFile,'utf8').catch(()=> 'error')).trim();
    if (mode === 'error') return res.writeHead(503).end('Fixture unavailable');
    const snap = demo.tick();
    if (mode === 'empty') snap.sessions = [];
    return res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(snap));
  }
  const path = new URL(req.url,'http://localhost').pathname;
  const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(resolve(root) + sep)) return res.writeHead(403).end();
  try { const body = await readFile(file); res.writeHead(200,{'content-type':types[extname(file)] || 'application/octet-stream','cache-control':'no-store'}).end(body); }
  catch { res.writeHead(404).end(); }
}).listen(port,'127.0.0.1',()=>console.log(`Fixture: http://localhost:${port}/?live`));
