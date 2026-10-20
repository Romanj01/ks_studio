import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('.',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8');
const files=['app.js','autonomous-demo.js','availability.js','browser-storage.js','demo-seed.js','request.js','reschedule.js','schedule.js','telegram.js','sw.js'];
for(const file of files){
  const checked=spawnSync(process.execPath,['--check',fileURLToPath(new URL(file,root))],{encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);
  for(const match of read(file).matchAll(/(?:from\s*|import\()\s*['"](\.\/[^'"]+)['"]/g))assert.ok(existsSync(new URL(match[1],root)),`${file}: missing ${match[1]}`);
}
const html=read('index.html');
assert.match(html,/<body data-demo="1" data-demo-storage="browser">/);
for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)){
  assert.ok(!match[1].startsWith('/'),'Entry assets must be relative');
  assert.ok(existsSync(new URL(match[1],root)),`Missing ${match[1]}`);
}
const manifest=JSON.parse(read('manifest.webmanifest'));
for(const key of ['id','scope','start_url'])assert.equal(manifest[key],'./');
for(const icon of manifest.icons){assert.ok(!icon.src.startsWith('/'));assert.ok(existsSync(new URL(icon.src,root)));}
for(const prefix of ['/','/detailing-github/','/another-repository/']){
  const url=new URL(prefix,'https://example.github.io');
  assert.equal(new URL(manifest.start_url,url).pathname,prefix);
  for(const icon of manifest.icons)assert.ok(new URL(icon.src,url).pathname.startsWith(prefix));
}
assert.ok(existsSync(new URL('.nojekyll',root)));
assert.ok(!existsSync(new URL('data/',root)));
console.log('JavaScript syntax, module imports, demo mode, assets and Pages paths: OK');
