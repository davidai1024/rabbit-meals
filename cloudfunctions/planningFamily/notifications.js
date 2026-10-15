'use strict';
const crypto=require('crypto'),model=require('./planning'),life=require('./menu-lifecycle');
const templates=Object.freeze([
 {kind:'menu',id:String(process.env.MENU_TEMPLATE_ID||'').trim(),title:'新订单通知'},
 {kind:'review',id:String(process.env.REVIEW_TEMPLATE_ID||'').trim(),title:'新评价提醒'}
]);
const messages={pending:'发送处理中',accepted:'微信已受理，实际送达以微信为准',needsAuthorization:'未订阅或授权已用完，请重新订阅',failed:'通知发送失败，菜单和点评已保存',unknown:'微信暂未确认，为避免重复提醒不自动重发',skipped:'身份或提醒偏好已变化，本次未发送'};
function responseStatus(value){const raw=value?.errCode??value?.errcode,code=Number(raw);if(raw==null||!Number.isFinite(code)||code<0)return 'unknown';return code===0?'accepted':code===43101?'needsAuthorization':'failed';}
const truncate=(value,max)=>Array.from(String(value||'').replace(/[\s\u0000-\u001f\u007f]+/g,' ').trim()).slice(0,max).join('');
function shanghaiTime(at){const x=new Date(at+8*60*60*1000);return `${x.getUTCFullYear()}-${String(x.getUTCMonth()+1).padStart(2,'0')}-${String(x.getUTCDate()).padStart(2,'0')} ${String(x.getUTCHours()).padStart(2,'0')}:${String(x.getUTCMinutes()).padStart(2,'0')}:${String(x.getUTCSeconds()).padStart(2,'0')}`;}
function eventFor(action,input,before,state,epoch,now){
 if(!['submitMenu','record'].includes(action))return null;
 const type=input.type||'next',key=model.planKey(type,input.period),old=model.getPlan(before,type,input.period),plan=state.plans[key];
 if(action==='submitMenu'){
  if(!plan||plan.status!=='submitted'||plan.version===old.version)return null;
  if(old.status!=='draft'&&old.submittedAt===plan.submittedAt&&life.sameOrder(old.lines,plan.lines,plan.type))return null;
  return {kind:'menu',key,epoch,eventKey:`${epoch}:menu:${key}:${plan.version}`,data:{name3:{value:'点餐者'},date4:{value:shanghaiTime(plan.submittedAt||now)},thing7:{value:type==='next'?'下周菜单待确认':'周末菜单待确认'}}};
 }
 const record=state.records.find(x=>x.key===key&&x.recipeId===input.id&&x.role==='guest');
 if(!record||before.records.some(x=>x.key===key&&x.recipeId===input.id&&x.role==='guest'))return null;
 const name=(plan?.recipes||state.recipes).find(x=>x.id===input.id)?.name||'菜品';
 return {kind:'review',key,epoch,eventKey:`${epoch}:review:${record.id}`,data:{time1:{value:shanghaiTime(record.at)},thing2:{value:`收到${truncate(name,11)}点评，点开查看`}}};
}
function createNotifications(cloud,{read,table,ids,waitMs=2000}={}){
 const db=cloud.database(),events='mealNotifications';let ready;
 const active=token=>!token||(!token.cancelled&&Date.now()<token.deadline);
 const initialize=()=>ready||(ready=(async()=>{try{await db.createCollection(events);}catch(e){if(!/already exist|已存在|EXIST/i.test(e.message||''))throw e;}})().then(()=>true).catch(()=>{ready=null;return false;}));
 function metadata(identity){
  const preferences=identity.notificationPreferences||{},last={};
  for(const {kind} of templates){const x=identity.notificationLast?.[kind];if(x&&messages[x.status]){const status=x.status==='pending'&&Date.now()-x.at>=waitMs?'unknown':x.status;last[kind]={status,at:x.at,text:messages[status]};}}
  const configured=templates.filter(x=>x.id);
  return {enabled:configured.length>0,canSubscribe:identity.role==='cook'&&configured.length>0,templates:configured.map(x=>({...x})),preferences:{menu:preferences.menu||'unset',review:preferences.review||'unset'},last};
 }
 async function preferences(uid,fid,data){
  const choices=data.choices;
  if(!choices||typeof choices!=='object'||Array.isArray(choices)||!Object.keys(choices).length||Object.keys(choices).some(kind=>!templates.some(x=>x.kind===kind)||!['accept','reject','ban'].includes(choices[kind])))throw Error('提醒授权结果无效，请重试');
  let identity,family;
  await db.runTransaction(async t=>{
   const doc=t.collection(ids).doc(uid),current=(await doc.get()).data;family=(await t.collection(table).doc(fid).get()).data;
   if(current.familyId!==fid||!family.members.includes(uid))throw Error('无权访问这张饭桌');
   if(current.role!=='cook')throw Error('只有大厨身份可开启饭桌提醒');
   const notificationPreferences={...(current.notificationPreferences||{}),...choices},notificationLast={...(current.notificationLast||{})};
   for(const kind of Object.keys(choices))delete notificationLast[kind];
   const update={notificationPreferences,notificationLast,notificationPreferencesAt:Date.now()};
   // Removed reminder statuses must also disappear from the persisted object.
   await doc.update({data:{...update,notificationLast:db.command.set(notificationLast)}});identity={...current,...update};
  });
  return {identity,family};
 }
 // Notification persistence is isolated from the completed business write.
 // Only the transaction that creates a durable claim may invoke WeChat once.
 async function claim(fid,sender,event,token){
  if(!event||!templates.some(x=>x.kind===event.kind&&x.id))return null;
  let item;
  await db.runTransaction(async t=>{
  item=null;if(!active(token))return;const family=await read(t.collection(table).doc(fid));
  if(!active(token)||!family?.members.includes(sender)||(family.resetEpoch||0)!==event.epoch)return;
  for(const target of family.members.filter(x=>x!==sender)){
   const identity=await read(t.collection(ids).doc(target));
   if(!active(token))return;
   if(!identity||identity.familyId!==fid||identity.role!=='cook'||identity.notificationPreferences?.[event.kind]!=='accept')continue;
   const id=crypto.createHash('sha256').update(JSON.stringify([fid,target,event.eventKey])).digest('hex'),doc=t.collection(events).doc(id);
   if(await read(doc))return null;
   if(!active(token))return;
   const now=Date.now(),record={familyId:fid,target,kind:event.kind,key:event.key,epoch:event.epoch,eventKey:event.eventKey,data:event.data,status:'pending',at:now};
   await doc.set({data:record});
   if(!active(token))return;
   await t.collection(ids).doc(target).update({data:{notificationLast:{...(identity.notificationLast||{}),[event.kind]:{claimId:id,status:'pending',at:now}}}});
   if(active(token))item={id,...record};return;
  }
  });return item||null;
 }
 async function finish(item,status){
  const at=Date.now();
  try{await db.runTransaction(async t=>{
   const doc=t.collection(events).doc(item.id),record=await read(doc);if(!record||record.status!=='pending')return;
   await doc.update({data:{status,finishedAt:at}});
   const recipientDoc=t.collection(ids).doc(item.target),identity=await read(recipientDoc);
   if(identity?.familyId===item.familyId&&identity.notificationLast?.[item.kind]?.claimId===item.id)await recipientDoc.update({data:{notificationLast:{...identity.notificationLast,[item.kind]:{claimId:item.id,status,at}}}});
  });}catch(e){/* A persisted pending claim is still not eligible for another send. */}
 }
 async function dispatch(item,token){
  if(!item||!active(token))return;
  if(!templates.some(x=>x.kind===item.kind&&x.id))return;
  let status='failed';
  try{
   const [identity,family]=await Promise.all([read(db.collection(ids).doc(item.target)),read(db.collection(table).doc(item.familyId))]);
   if(!active(token))return;
   if(!identity||!family?.members.includes(item.target)||(family.resetEpoch||0)!==item.epoch||identity.familyId!==item.familyId||identity.role!=='cook'||identity.notificationPreferences?.[item.kind]!=='accept'){await finish(item,'skipped');return;}
   const template=templates.find(x=>x.kind===item.kind);
   const miniprogramState=['developer','trial','formal'].includes(process.env.MINIPROGRAM_STATE)?process.env.MINIPROGRAM_STATE:'trial';
   const operation=Promise.resolve().then(()=>active(token)?cloud.openapi.subscribeMessage.send({touser:item.target,templateId:template.id,page:'pages/v3-history/index?key='+encodeURIComponent(item.key),miniprogramState,lang:'zh_CN',data:item.data}):null).then(responseStatus,responseStatus);
   let timer;
   status=await Promise.race([operation,new Promise(resolve=>{timer=setTimeout(()=>resolve('unknown'),Math.max(0,Math.min(waitMs,(token?.deadline??Infinity)-Date.now())));})]);clearTimeout(timer);
  }catch(e){status=Number(e?.errCode||e?.errcode)===43101?'needsAuthorization':'failed';}
  await finish(item,status);
 }
 async function deliver(fid,sender,event){
  if(!event||!templates.some(x=>x.kind===event.kind&&x.id))return;
  const token={cancelled:false,deadline:Date.now()+waitMs};let timer;
  const operation=(async()=>{if(!await initialize()||!active(token))return;const item=await claim(fid,sender,event,token);if(!active(token))return;await dispatch(item,token);})().catch(()=>{});
  await Promise.race([operation,new Promise(resolve=>{timer=setTimeout(()=>{token.cancelled=true;resolve();},waitMs);})]);
  token.cancelled=true;clearTimeout(timer);
 }
 return {initialize,metadata,preferences,claim,dispatch,deliver};
}
module.exports={createNotifications,eventFor,shanghaiTime,templates};
