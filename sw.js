const BASE=new URL('.',self.location.href),PREFIX='ks-studio-noginsk-github-static:'+BASE.pathname+':',CACHE=PREFIX+'ks-brand-v3';
const CORE=['','index.html','app.js','telegram.js','request.js','schedule.js','availability.js','reschedule.js','demo-seed.js','autonomous-demo.js','browser-storage.js','icon.svg','car-studio.png','brand-logo.png','work-polish.png','work-ceramic.png','work-interior.png','style.css','manifest.webmanifest','icon-192.png','icon-512.png'].map(path=>new URL(path,BASE).href);
const STATIC=new Set([...CORE,new URL('car-studio.png',BASE).href,new URL('icon.svg',BASE).href].map(url=>new URL(url).pathname));
async function fetchStatic(request,cacheMode='no-cache') {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8000);
  try {
    const response=await fetch(request,{signal:controller.signal,cache:cacheMode,credentials:'omit'});
    // Keep the deadline active until the response body has arrived as well.
    const body=await response.arrayBuffer();
    const headers=new Headers(response.headers);
    headers.delete('Content-Encoding');headers.delete('Content-Length');headers.delete('Transfer-Encoding');
    return new Response([204,205,304].includes(response.status)?null:body,{status:response.status,statusText:response.statusText,headers});
  } finally { clearTimeout(timer); }
}
async function updateStatic(cache,request,cacheMode='no-cache') {
  const response=await fetchStatic(request,cacheMode);
  if(response.ok)await cache.put(request,response.clone());
  return response;
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  // A release caches matching modules together; reuse the already downloaded hero image.
  for(const url of CORE){const response=await updateStatic(cache,new Request(url),url.endsWith('-studio.png')?'force-cache':'no-cache');if(!response.ok)throw new Error('Cannot cache '+url);}
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==BASE.origin||!STATIC.has(url.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE),cached=await cache.match(event.request);
    if(event.request.mode==='navigate'){try{return await updateStatic(cache,event.request);}catch{if(cached)return cached;}}
    if(cached){
      return cached;
    }
    try{return await updateStatic(cache,event.request);}
    catch{
      if(event.request.mode==='navigate')return new Response('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Нет связи</title><p>Не удалось загрузить сайт. Проверьте подключение и попробуйте ещё раз.</p><button onclick="location.reload()">Повторить</button></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}});
      return Response.error();
    }
  })());
});
