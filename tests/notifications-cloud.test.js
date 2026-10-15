require('./helpers/configure-cloud');
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../cloudfunctions/planningFamily/handler'),model=require('../cloudfunctions/planningFamily/planning'),notify=require('../cloudfunctions/planningFamily/notifications');
const {command,applyUpdate}=require('./helpers/cloud-update');
const copy=structuredClone,p=model.period(new Date('2026-10-12T12:00:00+08:00'));
function server(){
 const store={},sends=[],failures={collection:false,claim:false,result:null,send:null};let uid='guest',lock=Promise.resolve();
 const collection=name=>({doc:id=>({
  get:async()=>{if(name==='mealIdentities'&&id==='cook'&&Object.keys(store.mealNotifications||{}).length&&failures.identityGate)await failures.identityGate;if(!store[name]?.[id])throw Error('not exist');return {data:copy(store[name][id])};},
  set:async({data})=>{if(name==='mealNotifications'&&failures.claimGate)await failures.claimGate;if(name==='mealNotifications'&&failures.claim)throw Error('reminder storage unavailable');if(!store[name])throw Error('collection not exist');store[name][id]=copy(data);},
  update:async({data})=>{if(name==='mealNotifications'&&failures.finishGate)await failures.finishGate;if(!store[name]?.[id])throw Error('not exist');applyUpdate(store[name][id],data);}
 }),where:query=>({limit:()=>({get:async()=>({data:Object.entries(store[name]||{}).filter(([,x])=>x.code===query.code).map(([id,x])=>({...copy(x),_id:id}))})})})});
 const db={command,collection,createCollection:async name=>{if(name==='mealNotifications'&&failures.initializeGate)await failures.initializeGate;if(name==='mealNotifications'&&failures.collection)throw Error('create denied');if(store[name])throw Error('already exist');store[name]={};},runTransaction:fn=>{const task=lock.then(async()=>{const before=copy(store);try{return await fn({collection});}catch(e){for(const key of Object.keys(store))delete store[key];Object.assign(store,before);throw e;}});lock=task.catch(()=>{});return task;}};
 const cloud={database:()=>db,getWXContext:()=>({OPENID:uid}),getTempFileURL:async()=>({fileList:[]}),openapi:{subscribeMessage:{send:async data=>{sends.push(copy(data));if(failures.send)return failures.send(data);if(failures.result instanceof Error)throw failures.result;return failures.result||{errCode:0};}}}};
 const handler=createHandler(cloud,{notificationWaitMs:25,testTools:{enabled:true}});return {store,sends,failures,cloud,handler,as:x=>uid=x};
}
async function fixture(){
 const x=server(),created=await x.handler({action:'create',data:{role:'guest'}});x.as('cook');await x.handler({action:'join',data:{code:created.code,role:'cook'}});
 const preferences=choices=>x.handler({action:'notificationPreferences',data:{choices}});
 await preferences({menu:'accept',review:'accept'});x.as('guest');
 const family=()=>x.store.mealFamilies[created.familyId],recipe=()=>family().state.recipes[0],key=model.planKey('weekend',p);
 const seedDraft=()=>{family().state.plans[key]={key,type:'weekend',start:p.sat,end:p.sun,status:'draft',version:1,lines:[],draftLines:[{id:recipe().id,multiplier:1,day:p.sat,meal:'午餐'}]};};
 const seedCooked=()=>{family().state.plans[key]={key,type:'weekend',start:p.sat,end:p.sun,status:'cooked',version:3,lines:[{id:recipe().id,multiplier:1,tasks:{cook:true}}],recipes:[copy(recipe())]};};
 const call=(action,data={})=>x.handler({action,data:{period:p,type:'weekend',expectedRevision:family().revision,expectedResetEpoch:family().resetEpoch||0,...data}});
 const recipient=()=>x.store.mealIdentities.cook;
 return {...x,created,family,recipe,key,seedDraft,seedCooked,call,preferences,recipient};
}

test('模板字段与上海时间明确，长菜名仍符合thing 20字限制',()=>{
 assert.equal(notify.shanghaiTime(Date.parse('2026-10-12T23:59:07Z')),'2026-10-13 07:59:07');
 const before={plans:{},records:[],recipes:[{id:'r',name:'🥕'.repeat(40)}]},after={...before,plans:{[model.planKey('weekend',p)]:{version:1,status:'cooked',recipes:before.recipes}},records:[{id:'new-record',key:model.planKey('weekend',p),recipeId:'r',role:'guest',at:Date.parse('2026-10-12T01:02:03Z')}]};
 const event=notify.eventFor('record',{period:p,type:'weekend',id:'r'},before,after,2,Date.now());assert.equal(Array.from(event.data.thing2.value).length,20);assert.equal(event.data.time1.value,'2026-10-12 09:02:03');
 after.plans[model.planKey('weekend',p)].recipes[0].name='番茄\n\u0001炒蛋';assert.equal(notify.eventFor('record',{period:p,type:'weekend',id:'r'},before,after,2,Date.now()).data.thing2.value,'收到番茄 炒蛋点评，点开查看');
});
test('真实菜单提交通知另一位当前大厨，固定模板和真实菜单key，微信调用发生在业务提交后',async()=>{
 const x=await fixture();x.seedDraft();const before=x.family().revision;
 x.failures.send=async()=>{assert.equal(x.family().revision,before+1);assert.equal(x.family().state.plans[x.key].status,'submitted');return {errCode:0};};
 const r=await x.call('submitMenu',{touser:'outsider',templateId:'fake',data:{thing7:{value:'malicious'}}});assert.equal(r.ok,true);assert.equal(x.sends.length,1);
 assert.deepEqual(x.sends[0],{touser:'cook',templateId:notify.templates[0].id,page:'pages/v3-history/index?key='+encodeURIComponent(x.key),miniprogramState:'trial',lang:'zh_CN',data:{name3:{value:'点餐者'},date4:{value:notify.shanghaiTime(x.family().state.plans[x.key].submittedAt)},thing7:{value:'周末菜单待确认'}}});
 assert.equal(x.recipient().notificationLast.menu.status,'accepted');assert.equal(Object.keys(x.store.mealNotifications).length,1);
});
test('下周提示和跳转key按周一，绝不误用周六采购周期',()=>{
 const key=model.planKey('next',p),old={plans:{},records:[],recipes:[]},next={...old,plans:{[key]:{version:4,status:'submitted',submittedAt:Date.now()}}};
 const event=notify.eventFor('submitMenu',{period:p},old,next,0,Date.now());assert.equal(event.key,'next:2026-10-19');assert.equal(event.data.thing7.value,'下周菜单待确认');
});
test('首次点评发一次，修改同一点评、旧revision重试不再消耗授权',async()=>{
 const x=await fixture();x.seedCooked();const revision=x.family().revision,first=await x.call('record',{id:x.recipe().id,result:'吃完了',note:'很好吃'});assert.equal(first.ok,true);assert.equal(x.sends.length,1);assert.equal(x.sends[0].templateId,notify.templates[1].id);
 const second=await x.call('record',{id:x.recipe().id,result:'有剩余',note:'更正点评'});assert.equal(second.ok,true);assert.equal(x.sends.length,1);assert.equal(x.family().state.records.length,1);
 const stale=await x.call('record',{id:x.recipe().id,result:'吃完了',expectedRevision:revision});assert.equal(stale.ok,false);assert.equal(x.sends.length,1);
});
test('重复提交和相同菜篮不再提醒，真正修改口味后重新提交才提醒',async()=>{
 const x=await fixture();x.seedDraft();assert.equal((await x.call('submitMenu')).ok,true);assert.equal(x.sends.length,1);const version=x.family().state.plans[x.key].version;
 assert.equal((await x.call('submitMenu')).ok,true);assert.equal(x.family().state.plans[x.key].version,version);assert.equal(x.sends.length,1);
 const original=copy(x.family().state.plans[x.key]);assert.equal((await x.call('startEdit')).ok,true);assert.equal((await x.call('submitMenu')).ok,true);assert.equal(x.sends.length,1);
 assert.equal(x.family().state.plans[x.key].submittedAt,original.submittedAt);assert.equal(x.family().state.plans[x.key].draftLines,undefined);
 assert.equal((await x.call('startEdit')).ok,true);assert.equal((await x.call('selectDraft',{lines:original.lines.map(line=>({...line,spice:'少辣'}))})).ok,true);
 assert.equal((await x.call('submitMenu')).ok,true);assert.equal(x.sends.length,2);assert.equal(x.family().state.plans[x.key].lines[0].spice,'少辣');
});
test('重新点菜、未确认替换和取消菜篮都不提醒，明确替换提交才发新通知',async()=>{
 const x=await fixture();x.seedDraft();assert.equal((await x.call('submitMenu')).ok,true);assert.equal(x.sends.length,1);
 x.as('cook');assert.equal((await x.call('confirm')).ok,true);x.as('guest');const original=copy(x.family().state.plans[x.key]);
 const replacement=original.lines.map(line=>({...line,spice:'辣'}));assert.equal((await x.call('selectDraft',{lines:replacement})).ok,true);assert.equal(x.sends.length,1);
 const withBasket=copy(x.family().state.plans[x.key]);assert.equal(withBasket.draftIntent,'replacement');
 const unconfirmed=await x.call('submitMenu');assert.equal(unconfirmed.ok,false);assert.match(unconfirmed.error,/确认是否换成/);assert.equal(x.sends.length,1);assert.deepEqual(x.family().state.plans[x.key],withBasket);
 assert.equal((await x.call('discardDraft')).ok,true);assert.equal(x.sends.length,1);assert.deepEqual(x.family().state.plans[x.key].lines,original.lines);assert.equal(x.family().state.plans[x.key].status,'confirmed');
 assert.equal((await x.call('selectDraft',{lines:replacement})).ok,true);assert.equal((await x.call('submitMenu',{replaceConfirmed:true})).ok,true);assert.equal(x.sends.length,2);
 const updated=x.family().state.plans[x.key];assert.equal(updated.lines[0].spice,'辣');assert.equal(updated.status,'submitted');assert.equal(updated.confirmedAt,undefined);assert.equal(updated.draftIntent,undefined);
 assert.equal(Object.keys(x.family().state.plans).length,1);assert.equal(Object.keys(x.store.mealNotifications).length,2);
});
test('一次并发重复业务请求只产生一个claim和一次微信调用',async()=>{
 const x=await fixture();x.seedDraft();const data={period:p,type:'weekend',expectedRevision:x.family().revision,expectedResetEpoch:0};
 const responses=await Promise.all([x.handler({action:'submitMenu',data}),x.handler({action:'submitMenu',data})]);assert.equal(responses.filter(r=>r.ok).length,1);assert.equal(x.sends.length,1);assert.equal(Object.keys(x.store.mealNotifications).length,1);
});
test('持久claim跨处理器重建仍然只发送一次',async()=>{
 const x=await fixture();x.seedDraft();await x.call('submitMenu');const state=copy(x.family().state),event=notify.eventFor('submitMenu',{period:p,type:'weekend'},{...state,plans:{}},state,0,Date.now());
 const read=async doc=>{try{return (await doc.get()).data;}catch(e){if(/not exist/.test(e.message))return null;throw e;}};
 const fresh=notify.createNotifications(x.cloud,{read,table:'mealFamilies',ids:'mealIdentities',waitMs:10});assert.equal(await fresh.initialize(),true);assert.equal(await fresh.claim(x.created.familyId,'guest',event),null);assert.equal(x.sends.length,1);
});
test('微信43101提示重新订阅，不影响成功提交，重订阅清除旧提示且不伪报额度',async()=>{
 const x=await fixture();x.seedDraft();x.failures.result=Object.assign(Error('no quota'),{errCode:43101});const r=await x.call('submitMenu');assert.equal(r.ok,true);assert.equal(x.family().state.plans[x.key].status,'submitted');
 x.as('cook');const get=await x.handler({action:'get',revision:x.family().revision});assert.equal(get.unchanged,true);assert.equal(get.notifications.last.menu.status,'needsAuthorization');assert.match(get.notifications.last.menu.text,/重新订阅/);assert.equal(get.notifications.remaining,undefined);
 const sub=await x.preferences({menu:'accept'});assert.equal(sub.ok,true);assert.equal(sub.notifications.last.menu,undefined);assert.equal(sub.notifications.preferences.menu,'accept');assert.equal(sub.notifications.preferences.review,'accept');
 assert.equal(x.recipient().notificationLast.menu,undefined);
 const refreshed=await x.handler({action:'get',revision:x.family().revision});assert.equal(refreshed.notifications.last.menu,undefined);assert.equal(refreshed.notifications.preferences.review,'accept');
});
test('微信已知错误和超时都不回滚菜单，未知结果不会自动重发',async()=>{
 for(const mode of ['failed','unknown']){const x=await fixture();x.seedDraft();if(mode==='failed')x.failures.result={errCode:40037};else x.failures.send=()=>new Promise(()=>{});
  const r=await x.call('submitMenu');assert.equal(r.ok,true);if(mode==='unknown'){await new Promise(resolve=>setTimeout(resolve,5));assert.equal(notify.createNotifications(x.cloud,{waitMs:25}).metadata(x.recipient()).last.menu.status,'unknown');}else assert.equal(x.recipient().notificationLast.menu.status,mode);assert.equal(x.family().state.plans[x.key].status,'submitted');
  await x.call('submitMenu');assert.equal(x.sends.length,1);
 }
});
test('新集合初始化失败和claim存储失败均不影响菜单提交',async()=>{
 for(const mode of ['collection','claim']){const x=await fixture();x.seedDraft();x.failures[mode]=true;const r=await x.call('submitMenu');assert.equal(r.ok,true);assert.equal(x.family().state.plans[x.key].status,'submitted');assert.equal(x.sends.length,0);assert.equal(x.recipient().notificationLast.menu,undefined);}
});
test('只有自己当前大厨身份可授权，授权元数据不修改饭桌业务revision或清空备份',async()=>{
 const x=await fixture(),before=copy(x.family());x.as('guest');assert.equal((await x.preferences({menu:'accept'})).ok,false);assert.equal(x.store.mealIdentities.guest.notificationPreferences,undefined);
 x.as('cook');assert.equal((await x.preferences({menu:'reject',review:'ban'})).ok,true);assert.deepEqual(x.family(),before);assert.deepEqual(x.recipient().notificationPreferences,{menu:'reject',review:'ban'});assert.equal(x.store.mealIdentities.guest.notificationPreferences,undefined);
 for(const choices of [{menu:'enabled'},{malicious:'accept'},[],{},null])assert.equal((await x.preferences(choices)).ok,false);
});
test('未授权、拒绝、禁用、双方点餐、伪造跨家庭identity都不会通知',async()=>{
 for(const mode of ['unset','reject','ban','guest','foreign','removed']){const x=await fixture();x.seedDraft();
  if(['unset','reject','ban'].includes(mode))x.recipient().notificationPreferences.menu=mode==='unset'?undefined:mode;
  if(mode==='guest')x.recipient().role='guest';if(mode==='foreign')x.recipient().familyId='other';if(mode==='removed')x.family().members=['guest'];
  const r=await x.call('submitMenu');assert.equal(r.ok,true);assert.equal(x.sends.length,0);
 }
});
test('claim后切为点餐或关闭偏好，dispatch重验不会向其发送',async()=>{
 for(const mode of ['role','preference']){const x=await fixture();x.seedDraft();
  const state=model.apply(x.family().state,'guest','submitMenu',{type:'weekend',period:p}),event=notify.eventFor('submitMenu',{type:'weekend',period:p},x.family().state,state,0,Date.now());
  const read=async doc=>{try{return (await doc.get()).data;}catch(e){return null;}};const n=notify.createNotifications(x.cloud,{read,table:'mealFamilies',ids:'mealIdentities',waitMs:10});await n.initialize();const item=await n.claim(x.created.familyId,'guest',event);
  if(mode==='role')x.recipient().role='guest';else x.recipient().notificationPreferences.menu='reject';await n.dispatch(item);assert.equal(x.sends.length,0);assert.equal(x.recipient().notificationLast.menu.status,'skipped');
 }
});
test('清空和还原绝不发提醒，重置后同菜单版本的全新提交不被旧claim挡住',async()=>{
 const x=await fixture();x.seedDraft();await x.call('submitMenu');assert.equal(x.sends.length,1);const records=copy(x.store.mealNotifications);
 await x.call('resetTestData',{requestId:'reset-notifications-0001'});await x.call('restoreTestData',{requestId:'restore-notifications-0001'});assert.equal(x.sends.length,1);assert.deepEqual(x.store.mealNotifications,records);
 await x.call('resetTestData',{requestId:'reset-notifications-0002'});x.seedDraft();await x.call('submitMenu');assert.equal(x.sends.length,2);assert.equal(Object.keys(x.store.mealNotifications).length,2);
});
test('业务提交后claim之前重置，或claim后发送之前重置，均不发送旧epoch提醒',async()=>{
 for(const stage of ['claim','dispatch']){const x=await fixture();x.seedDraft();const state=model.apply(x.family().state,'guest','submitMenu',{type:'weekend',period:p}),event=notify.eventFor('submitMenu',{type:'weekend',period:p},x.family().state,state,0,Date.now());
  const read=async doc=>{try{return (await doc.get()).data;}catch(e){return null;}};const n=notify.createNotifications(x.cloud,{read,table:'mealFamilies',ids:'mealIdentities',waitMs:10});await n.initialize();let item;
  if(stage==='dispatch')item=await n.claim(x.created.familyId,'guest',event);
  x.family().resetEpoch=1;
  if(stage==='claim')assert.equal(await n.claim(x.created.familyId,'guest',event),null);else {await n.dispatch(item);assert.equal(x.recipient().notificationLast.menu.status,'skipped');}
  assert.equal(x.sends.length,0);
 }
});
test('通知初始化、claim写入和身份重验挂起都不阻塞业务回复，解除挂起后也不迟发',async()=>{
 for(const stage of ['initializeGate','claimGate','identityGate']){const x=await fixture();x.seedDraft();let release;const gate=new Promise(resolve=>{release=resolve;});x.failures[stage]=gate;
  const start=Date.now(),r=await x.call('submitMenu');assert.equal(r.ok,true);assert.ok(Date.now()-start<300);assert.equal(x.family().state.plans[x.key].status,'submitted');assert.equal(x.sends.length,0);
  release();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(x.sends.length,0);
 }
});
test('微信发送成功后finish挂起也及时返回，持久pending到期显示未知且不会重复发送',async()=>{
 const x=await fixture();x.seedDraft();let release;x.failures.finishGate=new Promise(resolve=>{release=resolve;});const start=Date.now(),r=await x.call('submitMenu');assert.equal(r.ok,true);assert.ok(Date.now()-start<300);assert.equal(x.sends.length,1);
 assert.equal(x.recipient().notificationLast.menu.status,'pending');
 const waitMs=25,n=notify.createNotifications(x.cloud,{waitMs}),expired=copy(x.recipient());expired.notificationLast.menu.at=Date.now()-waitMs-1;
 assert.equal(n.metadata(expired).last.menu.status,'unknown');assert.equal(x.recipient().notificationLast.menu.status,'pending');
 release();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(x.recipient().notificationLast.menu.status,'accepted');await x.call('submitMenu');assert.equal(x.sends.length,1);
});
test('发送操作网络拒绝但没有明确微信错误码时显示未知，不伪报确定失败',async()=>{
 for(const code of [undefined,-604102,-501002]){const x=await fixture();x.seedDraft();x.failures.result=Object.assign(Error('network timeout'),code?{errCode:code}:{});assert.equal((await x.call('submitMenu')).ok,true);assert.equal(x.recipient().notificationLast.menu.status,'unknown');}
});
test('返回的通知元数据不会暴露另一成员openid、内部claim或业务信息',async()=>{
 const x=await fixture();x.seedDraft();await x.call('submitMenu');x.as('cook');const get=await x.handler({action:'get'}),json=JSON.stringify(get.notifications);
 assert.equal(get.notifications.canSubscribe,true);assert.deepEqual(get.notifications.templates,notify.templates);assert.equal(get.notifications.last.menu.status,'accepted');assert.equal(json.includes('claimId'),false);assert.equal(json.includes('touser'),false);assert.equal(json.includes(x.key),false);
 x.as('guest');assert.equal((await x.handler({action:'get'})).notifications.canSubscribe,false);
});
