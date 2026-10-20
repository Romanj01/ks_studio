import {rescheduleBooking} from './reschedule.js';
import {canPerformService} from './availability.js';
import {seed,DEMO_KIND} from './demo-seed.js';
import {today,minutes,slots} from './availability.js';

const BASE=new URL('.',import.meta.url),databaseName=`ks-studio-noginsk-github-demo-v1:${DEMO_KIND}:${BASE.pathname}`;
const photoPrefix='demo-photo:',maxPhotoBytes=10*1024*1024,maxPhotoTotal=50*1024*1024;
const urls=new Map(),listeners=new Set();
let connectionPromise,defaultDigest,memoryRecord,memoryPhotos=new Map(),memoryQueue=Promise.resolve(),channel;
let persistence='persistent';
const id=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const text=(v,max=500)=>String(v??'').trim().slice(0,max);
const number=(v,min,max)=>{v=Number(v);if(!Number.isFinite(v)||v<min||v>max)fail('Проверьте числовые поля');return v;};
const integer=(v,min,max)=>{v=number(v,min,max);if(!Number.isInteger(v))fail('Укажите целое число');return v;};
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d&&d>=today()&&d<=new Date(Date.now()+180*86400000).toISOString().slice(0,10);
const fresh=()=>({version:1,db:{...seed(),admin:{digest:defaultDigest}},sessions:{},photos:[]});
const storageError=error=>error?.name==='QuotaExceededError'?new Error('В браузере недостаточно места. Удалите лишние фотографии или сбросьте демо.'):error;
const checkSize=record=>{if(new TextEncoder().encode(JSON.stringify(record)).byteLength>4*1024*1024)fail('Демо заполнено. Сбросьте его, чтобы продолжить.',413);};
function revokePhotos(){for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();}
export const demoImageUrl=path=>String(path||'').startsWith(photoPrefix)?urls.get(path)||'':String(path||'');
export const demoPersistence=()=>persistence;
export function onDemoChange(callback){listeners.add(callback);return ()=>listeners.delete(callback);}
function startChannel(){
 if(channel||!globalThis.BroadcastChannel)return;
 channel=new BroadcastChannel(databaseName);
 channel.onmessage=event=>{if(event.data?.reset)revokePhotos();for(const key of event.data?.deleted||[]){if(urls.has(key))URL.revokeObjectURL(urls.get(key));urls.delete(key);}for(const callback of listeners)callback();};
}
function changed(details){if(persistence!=='persistent')return;startChannel();channel?.postMessage({updated:true,...details});}
async function connection(){
 if(connectionPromise)return connectionPromise;
 startChannel();
 connectionPromise=new Promise((resolve,reject)=>{
  let request,settled=false;
  const timer=setTimeout(()=>finish(new Error('Хранилище демо занято. Закройте другие вкладки с этим демо и повторите загрузку.')),5000);
  function finish(error,db){if(settled){db?.close();return;}settled=true;clearTimeout(timer);error?reject(error):resolve(db);}
  try{
   request=indexedDB.open(databaseName,1);
   request.onupgradeneeded=()=>{request.result.createObjectStore('state');request.result.createObjectStore('photos');};
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();connectionPromise=null;};finish(null,db);};
   request.onerror=()=>finish(request.error);
   request.onblocked=()=>finish(new Error('Хранилище демо занято другой вкладкой. Закройте её и повторите загрузку.'));
  }catch(error){finish(error);}
 }).catch(error=>{
  if(['SecurityError','NotAllowedError','InvalidStateError'].includes(error?.name)||typeof indexedDB==='undefined'){
   persistence='memory';memoryRecord=fresh();return null;
  }
  connectionPromise=null;throw storageError(error);
 });
 return connectionPromise;
}
async function transaction(write,callback,signal){
 const db=await connection();if(signal?.aborted)throw new DOMException('Запрос отменён','AbortError');
 if(!db){
  const action=memoryQueue.then(()=>{
   if(signal?.aborted)throw new DOMException('Запрос отменён','AbortError');
   const record=structuredClone(memoryRecord),photos=new Map(memoryPhotos);
   const result=callback(record,{put:(blob,key)=>photos.set(key,blob),delete:key=>photos.delete(key),clear:()=>photos.clear()});
   if(write){checkSize(record);memoryRecord=record;memoryPhotos=photos;}
   return structuredClone(result);
  });
  memoryQueue=action.catch(()=>{});return action;
 }
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(['state','photos'],write?'readwrite':'readonly');let result,reason;
  const abort=error=>{reason=error;try{tx.abort();}catch{};};
  const onAbort=()=>abort(new DOMException('Запрос отменён','AbortError'));
  const timer=setTimeout(()=>abort(new Error('Сохранение демо заняло слишком много времени. Попробуйте ещё раз.')),8000);
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);};
  signal?.addEventListener('abort',onAbort,{once:true});
  tx.oncomplete=()=>{cleanup();resolve(result);};
  tx.onabort=()=>{cleanup();reject(storageError(reason||tx.error||new Error('Не удалось сохранить демо.')));};
  const request=tx.objectStore('state').get('current');
  request.onsuccess=()=>{
   try{
    const record=request.result||fresh();
    result=callback(record,tx.objectStore('photos'));
    if(write){checkSize(record);tx.objectStore('state').put(record,'current');}
   }catch(error){abort(error);}
  };
 });
}
async function hydratePhotos(data,signal){
 const references=[...new Set([...(data?.portfolio||[]).map(p=>p.image),data?.settings?.heroImage].filter(image=>typeof image==='string'&&image.startsWith(photoPrefix)))];
 if(!references.length)return;
 const db=await connection();
 const blobs=db?await new Promise((resolve,reject)=>{
  const tx=db.transaction('photos','readonly'),result=new Map();let reason;
  const onAbort=()=>{reason=new DOMException('Запрос отменён','AbortError');try{tx.abort();}catch{}};
  const timer=setTimeout(()=>{reason=new Error('Не удалось прочитать фотографии демо.');try{tx.abort();}catch{}},8000);
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);};
  signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();
  tx.oncomplete=()=>{cleanup();resolve(result);};tx.onabort=()=>{cleanup();reject(reason||tx.error);};
  for(const key of references){const request=tx.objectStore('photos').get(key);request.onsuccess=()=>{if(request.result)result.set(key,request.result);};}
 }):memoryPhotos;
 if(signal?.aborted)throw new DOMException('Запрос отменён','AbortError');
 for(const key of references)if(!urls.has(key)&&blobs.has(key))urls.set(key,URL.createObjectURL(blobs.get(key)));
}
function publicData(db){return {settings:db.settings,masters:db.masters||[],services:db.services,portfolio:db.portfolio,reviews:db.reviews.filter(r=>r.status==='approved'&&r.featured),promos:[],registrationAvailable:true,telegramAvailable:false,today:today()};}
function run(record,photos,path,method,b,token,prepared){
 const db=record.db;
 const auth=role=>{const session=record.sessions[token];if(!session||session.until<Date.now()||role&&session.role!==role)fail('Войдите в аккаунт',401);return session;};
 const login=(role,customerId)=>{const token=id()+id();record.sessions[token]={role,customerId,until:Date.now()+7*86400000};return token;};
 const clean=b=>{const {guestToken,guestUntil,...view}=b;return view;};
 const emailValue=value=>{const email=String(value||'').trim().toLowerCase();if(email.length>254||! /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))fail('Укажите корректную почту');return email;};
 db.emailTokens??=[];
 db.telegramLinks??=[];
 const telegramStatus=c=>{const p=db.telegramLinks.find(x=>x.customerId===c.id&&x.session===token&&x.until>Date.now());return {enabled:true,demo:true,botUrl:'',linked:!!c.telegram,identity:c.telegram?{name:c.telegram.name,username:c.telegram.username}:null,notifications:c.telegram?.notifications!==false,pending:p?{id:p.id,received:!!p.candidate,identity:p.candidate,expiresAt:p.until}:null};};
 if(path.pathname.startsWith('/client/telegram')){
  const c=db.customers.find(c=>c.id===auth('client').customerId);if(!c?.emailVerified)fail('Подтвердите почту',403);
  if(path.pathname==='/client/telegram'&&method==='GET')return telegramStatus(c);
  if(path.pathname==='/client/telegram/link'&&method==='POST'){if(c.telegram)fail('Telegram уже подключен');db.telegramLinks=db.telegramLinks.filter(x=>x.customerId!==c.id);db.telegramLinks.push({id:id(),customerId:c.id,session:token,until:Date.now()+600000});return telegramStatus(c);}
  if(path.pathname==='/client/telegram/demo-start'&&method==='POST'){const p=db.telegramLinks.find(x=>x.customerId===c.id&&x.session===token&&x.until>Date.now());if(!p)fail('Ссылка истекла');p.candidate={name:'Демо-клиент',username:'demo_client'};return telegramStatus(c);}
  if(path.pathname==='/client/telegram/confirm'&&method==='POST'){const p=db.telegramLinks.find(x=>x.customerId===c.id&&x.session===token&&x.id===b.id&&x.until>Date.now());if(!p?.candidate)fail('Бот еще не запущен');c.telegram={...p.candidate,notifications:true};db.telegramLinks=db.telegramLinks.filter(x=>x.customerId!==c.id);return telegramStatus(c);}
  if(path.pathname==='/client/telegram/cancel'&&method==='POST'){db.telegramLinks=db.telegramLinks.filter(x=>x.customerId!==c.id);return {ok:true};}
  if(path.pathname==='/client/telegram/notifications'&&method==='POST'){if(!c.telegram)fail('Подключите Telegram');c.telegram.notifications=!!b.enabled;return telegramStatus(c);}
  if(path.pathname==='/client/telegram/unlink'&&method==='POST'){if(c.passwordDigest!==prepared.passwordDigest)fail('Пароль не совпал',401);delete c.telegram;db.telegramLinks=db.telegramLinks.filter(x=>x.customerId!==c.id);db.emailTokens=db.emailTokens.filter(x=>!(x.customerId===c.id&&x.channel==='telegram'));return telegramStatus(c);}
  if(path.pathname==='/client/telegram/demo-reset'&&method==='POST'){if(!c.telegram)fail('Подключите Telegram');const proof=id()+id();db.emailTokens=db.emailTokens.filter(x=>x.customerId!==c.id);db.emailTokens.push({token:proof,purpose:'reset',email:c.email,customerId:c.id,channel:'telegram',until:Date.now()+1800000});return {demoLink:BASE.href+'#reset='+proof};}
 }
 if(path.pathname==='/admin/telegram'&&method==='GET'){auth('admin');return {enabled:true,mode:'demo',pending:0,failed:0,sent:0};}
 const guest=idValue=>{const booking=db.bookings.find(x=>x.id===idValue);if(!booking||booking.guestToken!==(b.guestToken||token)||booking.guestUntil<Date.now())fail('Ссылка на запись недействительна',404);return booking;};
 if(path.pathname==='/logout'&&method==='POST'){delete record.sessions[token];return {ok:true};}
 if(path.pathname==='/auth/register'&&method==='POST'){
  const email=emailValue(b.email),name=text(b.name,80);if(name.length<2)fail('Укажите имя');let claim;if(b.guestId)claim=guest(b.guestId);let legacy;try{const current=db.customers.find(c=>c.id===auth('client').customerId);if(current&&!current.emailVerified)legacy=current;}catch{}
  if(db.customers.some(c=>c.email===email&&c.emailVerified))return {ok:true,message:'Для этой почты уже есть кабинет. Войдите в него.'};
  const code=id()+id();db.emailTokens=db.emailTokens.filter(t=>t.email!==email||t.purpose!=='verify');db.emailTokens.push({token:code,purpose:'verify',email,name,phone:text(b.phone,40),claimId:claim?.id,legacyId:legacy?.id,until:Date.now()+3600000});
  return {ok:true,message:'В демо письмо не отправляется. Откройте тестовую ссылку.',demoLink:BASE.href+'#verify='+code};
 }
 if(path.pathname==='/auth/verify'&&method==='POST'){
  const proof=db.emailTokens.find(t=>t.token===b.token&&t.purpose==='verify'&&t.until>Date.now());if(!proof)fail('Ссылка недействительна или истекла');if(text(b.password,200).length<10)fail('Минимум 10 символов');if(db.customers.some(c=>c.email===proof.email&&c.emailVerified))fail('Кабинет уже существует');
  let customer=proof.legacyId?db.customers.find(x=>x.id===proof.legacyId&&!x.emailVerified):undefined;if(proof.legacyId&&!customer)fail('Кабинет уже обновлен');if(customer)Object.assign(customer,{email:proof.email,emailVerified:true,passwordDigest:prepared.passwordDigest});else{customer={id:id(),name:proof.name,phone:proof.phone,email:proof.email,emailVerified:true,passwordDigest:prepared.passwordDigest};db.customers.push(customer);}if(proof.legacyId)for(const[key,session]of Object.entries(record.sessions))if(session.customerId===customer.id)delete record.sessions[key];
  const booking=db.bookings.find(x=>x.id===proof.claimId);if(booking&&!booking.customerId){booking.customerId=customer.id;booking.email=customer.email;delete booking.guestToken;delete booking.guestUntil;}
  db.emailTokens=db.emailTokens.filter(t=>t!==proof);return {token:login('client',customer.id),authenticated:true};
 }
 if(path.pathname==='/auth/forgot'&&method==='POST'){
  const email=emailValue(b.email),c=db.customers.find(c=>c.email===email&&c.emailVerified);let demoLink;
  if(c){const code=id()+id();db.emailTokens=db.emailTokens.filter(t=>t.email!==email||t.purpose!=='reset');db.emailTokens.push({token:code,purpose:'reset',customerId:c.id,email,until:Date.now()+1800000});demoLink=BASE.href+'#reset='+code;}
  return {ok:true,message:'Если кабинет существует, в демо доступна тестовая ссылка.',demoLink};
 }
 if(path.pathname==='/auth/reset'&&method==='POST'){
  const proof=db.emailTokens.find(t=>t.token===b.token&&t.purpose==='reset'&&t.until>Date.now());if(!proof)fail('Ссылка недействительна или истекла');if(text(b.password,200).length<10)fail('Минимум 10 символов');const c=db.customers.find(x=>x.id===proof.customerId);c.passwordDigest=prepared.passwordDigest;db.emailTokens=db.emailTokens.filter(t=>t.customerId!==c.id);for(const [key,session] of Object.entries(record.sessions))if(session.customerId===c.id)delete record.sessions[key];return {ok:true};
 }
 if(path.pathname==='/client/login'&&method==='POST'&&b.email!==undefined){const email=emailValue(b.email),c=db.customers.find(c=>c.email===email&&c.emailVerified&&c.passwordDigest===prepared.passwordDigest);if(!c)fail('Почта или пароль не совпали',401);return {token:login('client',c.id)};}
 if(path.pathname==='/client/claim'&&method==='POST'){const c=db.customers.find(x=>x.id===auth('client').customerId);if(!c?.emailVerified)fail('Подтвердите почту',403);const booking=guest(b.guestId);if(booking.customerId)fail('Запись уже в кабинете');booking.customerId=c.id;booking.email=c.email;delete booking.guestToken;delete booking.guestUntil;return {ok:true};}
 const guestRoute=path.pathname.match(/^\/guest\/([a-f0-9]{32})$/);
 if(guestRoute){const booking=guest(guestRoute[1]);if(method==='GET')return {booking:clean(booking)};if(method==='PATCH'){
  if(b.action==='cancel'){if(!['pending','proposed','confirmed'].includes(booking.status))fail('Свяжитесь с салоном');booking.status='cancelled';}
  else if(b.action==='accept'){if(booking.status!=='proposed')fail('Нет изменений');booking.status='confirmed';}
  else if(b.action==='message'){if(!text(b.message,1000))fail('Введите сообщение');booking.messages.push({from:'client',text:text(b.message,1000),at:new Date().toISOString()});}else fail('Неизвестное действие');return {ok:true};}}
 const imageUrl=value=>{value=text(value,2000);if(value!==`/${DEMO_KIND==='beauty'?'beauty':'car'}-studio.png`&&!/^https:\/\//i.test(value)&&!record.photos.some(photo=>photo.key===value))fail('Выберите загруженное фото или HTTPS-ссылку');return value;};
 if(method==='GET'&&path.pathname==='/public')return publicData(db);
 if(method==='GET'&&path.pathname==='/demo')return {enabled:true,storage:persistence};
 if(method==='POST'&&path.pathname==='/demo/reset'){Object.assign(record,fresh());photos.clear();return {ok:true};}
 if(method==='GET'&&path.pathname==='/slots'){
  const service=db.services.find(s=>s.id===path.searchParams.get('service')),date=path.searchParams.get('date');
  if(!service||!validDate(date))fail('Выберите услугу и дату');return slots(db,date,service.duration,undefined,path.searchParams.get('master'),service.id);
 }
 if(method==='POST'&&path.pathname==='/admin/login'){
  if(b.login!=='admin'||prepared.passwordDigest!==db.admin.digest)fail('Неверный логин или пароль',401);return {token:login('admin')};
 }
 if(method==='POST'&&path.pathname==='/client/login'){
  const phone=text(b.phone,40).replace(/\D/g,''),matches=db.customers.filter(c=>c.phone.replace(/\D/g,'')===phone&&c.emailVerified&&c.passwordDigest===prepared.passwordDigest);
  if(matches.length!==1)fail('Телефон или пароль не совпали. Попробуйте вход по почте.',401);return {token:login('client',matches[0].id)};
 }
 if(method==='POST'&&path.pathname==='/bookings'){
  const service=db.services.find(s=>s.id===b.service);if(!service||!validDate(b.date))fail('Выберите услугу и дату');
  const requestedMasterId=text(b.masterId,40);let masterId=requestedMasterId;if(masterId&&!(db.masters||[]).some(m=>m.id===masterId&&m.active&&canPerformService(m,service.id)))fail('Мастер не выполняет выбранную услугу или не принимает записи');const flexible=b.mode==='master';if(flexible&&!masterId)fail('Выберите мастера');let slot=slots(db,b.date,service.duration,undefined,requestedMasterId,service.id).find(s=>s.available&&(flexible||s.time===b.time));if(flexible&&!slot)fail('На эту дату у мастера нет свободного времени. Выберите другую дату.',409);if(!slot)fail('Это время уже занято. Выберите другое.',409);
  const name=text(b.name,80),phone=text(b.phone,40).replace(/\D/g,'');if(name.length<2||phone.length<10||phone.length>15)fail('Укажите имя и корректный телефон');
  let customer;try{customer=db.customers.find(c=>c.id===auth('client').customerId);}catch{}
  const email=b.email?emailValue(b.email):customer?.email||'';
  const promo=b.promo?db.promos.find(p=>p.active&&p.code===text(b.promo,40).toUpperCase()):undefined;
  if(b.promo&&!customer?.emailVerified)fail('Купоны доступны после подтверждения почты',403);if(b.promo&&!promo)fail('Промокод не найден');if(promo?.expiresAt&&promo.expiresAt<today())fail('Купон истек');if(promo&&db.bookings.filter(x=>x.customerId===customer.id&&x.promo===promo.code&&x.status!=='cancelled').length>=(promo.maxUsesPerCustomer||1))fail('Купон уже использован');
  masterId=slot.masterId||requestedMasterId;
  const booking={id:id(),customerId:customer?.id||null,email,name,phone,serviceId:service.id,service:service.name,date:b.date,masterId,master:(db.masters||[]).find(m=>m.id===masterId)?.name||'',mode:flexible?'master':'time',start:slot.start,duration:service.duration,price:Math.round(service.price*(1-(promo?.percent||0)/100)),promo:promo?.code||'',status:flexible?'confirmed':'pending',notes:text(b.notes,1000),messages:[],createdAt:new Date().toISOString()};
  if(DEMO_KIND==='detailing')booking.car=text(b.car,100);
  const guestToken=customer?undefined:id()+id();if(guestToken){booking.guestToken=guestToken;booking.guestUntil=Date.now()+180*86400000;}db.bookings.push(booking);return {booking:clean(booking),guest:guestToken?{id:booking.id,token:guestToken}:undefined,authenticated:!!customer};
 }
 if(path.pathname==='/client'&&method==='GET'){
  const session=auth('client'),customer=db.customers.find(c=>c.id===session.customerId);if(!customer)fail('Войдите в аккаунт',401);
  return {telegram:telegramStatus(customer),customer:{name:customer.name,phone:customer.phone,email:customer.email||'',emailVerified:!!customer.emailVerified},bookings:db.bookings.filter(b=>b.customerId===customer.id).map(clean),promos:customer.emailVerified?db.promos.filter(p=>p.active):[]};
 }
 if(path.pathname.startsWith('/client/bookings/')&&method==='PATCH'){
  const session=auth('client'),booking=db.bookings.find(x=>x.id===path.pathname.split('/').at(-1)&&x.customerId===session.customerId);if(!booking)fail('Заявка не найдена',404);
  if(b.action==='accept'){if(booking.status!=='proposed')fail('Нет изменений для согласования');booking.status='confirmed';}
  else if(b.action==='cancel'){if(['completed','in_progress','cancelled'].includes(booking.status))fail('Свяжитесь с администратором для отмены');booking.status='cancelled';}
  else if(b.action==='message'){if(!text(b.message,1000))fail('Введите сообщение');booking.messages.push({from:'client',text:text(b.message,1000),at:new Date().toISOString()});}
  else fail('Неизвестное действие');return {ok:true};
 }
 if(path.pathname==='/reviews'&&method==='POST'){
  const session=auth('client');if(!db.bookings.some(x=>x.customerId===session.customerId&&x.status==='completed'))fail('Отзыв можно оставить после завершения работ');
  const customer=db.customers.find(c=>c.id===session.customerId);if(text(b.text,1500).length<10)fail('Напишите хотя бы 10 символов');
  db.reviews.push({id:id(),customerId:customer.id,name:customer.name,rating:integer(b.rating,1,5),text:text(b.text,1500),status:'pending',featured:false});return {ok:true};
 }
 if(path.pathname.startsWith('/admin')){
  auth('admin');
  if(path.pathname==='/admin'&&method==='GET')return {...publicData(db),bookings:db.bookings,reviews:db.reviews,promos:db.promos};
  if(path.pathname==='/admin/password'&&method==='POST'){
   if(prepared.oldPasswordDigest!==db.admin.digest)fail('Текущий пароль неверен');if(text(b.password,200).length<10)fail('Минимум 10 символов');db.admin.digest=prepared.passwordDigest;record.sessions={};return {ok:true};
  }
  if(path.pathname==='/admin/uploads'&&method==='POST'){
   if(record.photos.reduce((sum,p)=>sum+p.size,0)+prepared.file.size>maxPhotoTotal)fail('Лимит фотографий демо — 50 МБ',413);
   const key=photoPrefix+id();record.photos.push({key,size:prepared.file.size});photos.put(prepared.file,key);return {url:key};
  }
  if(path.pathname==='/admin/settings'&&method==='PUT'){
   if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.open)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.close)||minutes(b.close)<=minutes(b.open))fail('Проверьте время работы');
   if(!Array.isArray(b.days)||!b.days.length||b.days.some(d=>!Number.isInteger(d)||d<0||d>6))fail('Выберите рабочие дни');
   if(!text(b.name,80))fail('Укажите название');
   if(b.heroImage)imageUrl(b.heroImage);
   db.settings={heroImage:text(b.heroImage,2000),socialUrl:text(b.socialUrl,2000),privacyUrl:text(b.privacyUrl,2000),name:text(b.name,80),tagline:text(b.tagline,120),address:text(b.address,200),phone:text(b.phone,40),open:b.open,close:b.close,step:integer(b.step,15,240),defaultDuration:integer(b.defaultDuration,15,720),capacity:integer(b.capacity??db.settings.capacity??1,1,50),days:b.days};return {ok:true};
  }
  if(path.pathname==='/admin/masters'&&method==='PUT'){if(!Array.isArray(b.masters)||b.masters.length>50)fail('Не более 50 мастеров');const ids=new Set();const masters=b.masters.map(m=>{const key=text(m.id,40)||id();if(ids.has(key)||!text(m.name,80))fail('Укажите имя и уникальный идентификатор мастера');ids.add(key);const serviceIds=m.serviceIds===undefined?(db.masters||[]).find(x=>x.id===key)?.serviceIds??null:m.serviceIds;if(serviceIds!==null&&(!Array.isArray(serviceIds)||serviceIds.length>30||serviceIds.some(id=>typeof id!=='string'||!db.services.some(s=>s.id===id))||new Set(serviceIds).size!==serviceIds.length))fail('Выберите услуги мастера из списка');return {id:key,name:text(m.name,80),specialty:text(m.specialty,150),active:m.active!==false,serviceIds};});if((db.masters||[]).some(m=>!ids.has(m.id)&&db.bookings.some(x=>x.masterId===m.id&&x.status!=='cancelled'&&x.status!=='completed')))fail('У мастера есть записи. Отключите прием вместо удаления.');db.masters=masters;return {ok:true};}
  if(path.pathname==='/admin/services'&&method==='PUT'){
   if(!Array.isArray(b.services)||!b.services.length||b.services.length>30)fail('Добавьте от 1 до 30 услуг');
   const ids=new Set();db.services=b.services.map(s=>{const key=text(s.id,40)||id();if(ids.has(key))fail('Услуги должны иметь разные идентификаторы');ids.add(key);return {id:key,name:text(s.name,100)||'Услуга',description:text(s.description,300),price:number(s.price,0,10000000),duration:integer(s.duration,15,1440)};});return {ok:true};
  }
  if(path.pathname.startsWith('/admin/bookings/')&&method==='PATCH'){
   const booking=db.bookings.find(x=>x.id===path.pathname.split('/').at(-1));if(!booking)fail('Заявка не найдена',404);if(b.action==='reschedule')return rescheduleBooking(db,booking,b.date,b.time);
   if(b.message){booking.messages.push({from:'admin',text:text(b.message,1000),at:new Date().toISOString()});return {ok:true};}
   const status=b.status;if(!['pending','proposed','confirmed','in_progress','completed','cancelled'].includes(status))fail('Проверьте статус');
   if(b.time!==undefined&&b.time!==''&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time))fail('Проверьте время');
   const masterId=b.masterId===undefined?(booking.masterId||''):text(b.masterId,40);if(masterId&&!(db.masters||[]).some(m=>m.id===masterId&&(m.active||m.id===booking.masterId)))fail('Мастер недоступен');const date=b.date??booking.date,start=b.time?minutes(b.time):booking.start,duration=b.duration===undefined?booking.duration:integer(b.duration,15,1440),price=b.price===undefined?booking.price:number(b.price,0,10000000);
   if(status!=='cancelled'&&masterId&&(masterId!==(booking.masterId||'')||date!==booking.date||start!==booking.start||duration!==booking.duration||booking.status==='cancelled')&&!(db.masters||[]).some(m=>m.id===masterId&&m.active&&canPerformService(m,booking.serviceId)))fail('Мастер не выполняет услугу этой записи');if(status!=='cancelled'&&start==null&&status!=='pending')fail('Сначала назначьте время');if(status!=='cancelled'&&(masterId!==(booking.masterId||'')||date!==booking.date||start!==booking.start||duration!==booking.duration||booking.status==='cancelled'))if(!validDate(date)||!slots(db,date,duration,booking.id,masterId).some(s=>s.available&&(start==null||s.start===start)))fail('Выбранное окно недоступно',409);
   const different=masterId!==(booking.masterId||'')||date!==booking.date||start!==booking.start||duration!==booking.duration||price!==booking.price||text(b.work??booking.work,1000)!==text(booking.work,1000);
   if(booking.status==='completed'&&different)fail('Завершенную запись нельзя изменить');
   Object.assign(booking,{date,start,duration,price,masterId,master:(db.masters||[]).find(m=>m.id===masterId)?.name||'',work:text(b.work??booking.work,1000),status:different&&status!=='cancelled'?(start==null?'pending':'proposed'):status});return {ok:true};
  }
  if(path.pathname.startsWith('/admin/reviews/')&&method==='PATCH'){
   const review=db.reviews.find(x=>x.id===path.pathname.split('/').at(-1));if(!review)fail('Отзыв не найден',404);if(!['approved','pending','rejected'].includes(b.status))fail('Неверный статус');review.status=b.status;review.featured=Boolean(b.featured)&&review.status==='approved';return {ok:true};
  }
  if(path.pathname==='/admin/promos'&&method==='PUT'){
   if(!Array.isArray(b.promos)||b.promos.length>30)fail('Не более 30 промокодов');const codes=new Set();
   db.promos=b.promos.map(p=>{const code=text(p.code,40).toUpperCase();if(!/^[A-Z0-9_-]{2,40}$/.test(code)||codes.has(code))fail('Коды должны быть уникальными: латиница, цифры, дефис');codes.add(code);return {id:p.id||id(),code,title:text(p.title,100),percent:number(p.percent,0,100),expiresAt:text(p.expiresAt,10),maxUsesPerCustomer:integer(p.maxUsesPerCustomer||1,1,1000),active:Boolean(p.active)};});return {ok:true};
  }
  if(path.pathname==='/admin/portfolio'&&method==='PUT'){
   if(!Array.isArray(b.portfolio)||b.portfolio.length>30)fail('Не более 30 работ');
   db.portfolio=b.portfolio.map(p=>({id:p.id||id(),title:text(p.title,100),category:text(p.category,100),image:imageUrl(p.image),...(DEMO_KIND==='beauty'?{caption:text(p.caption,100),demo:p.image==='/beauty-studio.png'}:{car:text(p.car,100),demo:p.image==='/car-studio.png'})}));
   const keep=new Set([...db.portfolio.map(p=>p.image),db.settings.heroImage]);prepared.deletedPhotos=[];record.photos=record.photos.filter(p=>{if(keep.has(p.key))return true;photos.delete(p.key);prepared.deletedPhotos.push(p.key);return false;});return {ok:true};
  }
 }
 fail('Не найдено',404);
}
export async function demoRequest(url,options={}){
 if(!crypto.subtle)throw new Error('Для запуска демо откройте сайт по HTTPS.');
 defaultDigest??=await digest('0123456789');
 const path=new URL(url,BASE);const apiPrefix=new URL('api',BASE).pathname;
 if(!path.pathname.startsWith(apiPrefix+'/'))fail('Не найдено',404);
 path.pathname=path.pathname.slice(apiPrefix.length);
 const method=(options.method||'GET').toUpperCase(),prepared={};let b={};
 if(options.signal?.aborted)throw new DOMException('Запрос отменён','AbortError');
 if(path.pathname==='/admin/uploads'&&method==='POST'){
  const file=options.body;if(!(file instanceof Blob)||file.size>maxPhotoBytes)fail('Фото должно быть не больше 10 МБ',413);
  const head=new Uint8Array(await file.slice(0,12).arrayBuffer());
  const valid=head.length>8&&head.slice(0,8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i])||head.length>3&&head[0]===255&&head[1]===216&&head[2]===255||head.length===12&&new TextDecoder().decode(head.slice(0,4))==='RIFF'&&new TextDecoder().decode(head.slice(8))==='WEBP';
  if(!valid)fail('Поддерживаются JPEG, PNG и WebP');prepared.file=file;
 }else if(method!=='GET'){
  try{b=JSON.parse(options.body||'{}');}catch{fail('Некорректный JSON');}
  if(!b||typeof b!=='object'||Array.isArray(b))fail('Ожидается объект JSON');
  if('password'in b)prepared.passwordDigest=await digest(text(b.password,200));
  if('oldPassword'in b)prepared.oldPasswordDigest=await digest(text(b.oldPassword,200));
  if('code'in b)prepared.codeDigest=await digest(text(b.code,100));
  if(path.pathname==='/bookings'){prepared.newCode=id().slice(0,12);prepared.newCodeDigest=await digest(prepared.newCode);}
 }
 const token=new Headers(options.headers).get('Authorization')?.replace(/^Bearer /,'');
 const result=await transaction(method!=='GET',(record,photos)=>run(record,photos,path,method,b,token,prepared),options.signal);
 if(method!=='GET'){
  if(path.pathname==='/demo/reset')revokePhotos();
  if(prepared.file&&result.url)urls.set(result.url,URL.createObjectURL(prepared.file));
  for(const key of prepared.deletedPhotos||[]){if(urls.has(key))URL.revokeObjectURL(urls.get(key));urls.delete(key);}
  changed({reset:path.pathname==='/demo/reset',deleted:prepared.deletedPhotos||[]});
 }
 await hydratePhotos(result,options.signal);
 return result;
}


