// Local preview only. GitHub Pages serves the files directly, without Node.js.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,extname} from 'node:path';

const root=fileURLToPath(new URL('.',import.meta.url));
const files=new Set(['index.html','app.js','autonomous-demo.js','availability.js','browser-storage.js','demo-seed.js','request.js','reschedule.js','schedule.js','telegram.js','sw.js','style.css','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','car-studio.png','brand-logo.png','work-polish.png','work-ceramic.png','work-interior.png']);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const port=Number(process.env.PORT||4354),prefix='/ks-studio-noginsk/';
createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path===prefix.slice(0,-1)){res.writeHead(308,{Location:prefix});res.end();return;}
  const name=(path.startsWith(prefix)?path.slice(prefix.length):path.slice(1))||'index.html';
  if(req.method!=='GET'&&req.method!=='HEAD'||!files.has(name)){res.writeHead(404);res.end('Not found');return;}
  try{
    const data=await readFile(join(root,name));
    res.writeHead(200,{'Content-Type':mime[extname(name)]||'application/octet-stream','Cache-Control':'no-cache'});
    res.end(req.method==='HEAD'?undefined:data);
  }catch{res.writeHead(500);res.end('Cannot read file');}
}).listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}${prefix}\nRoot:  http://127.0.0.1:${port}/\nStop: Ctrl+C`));
