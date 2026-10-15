require('./helpers/configure-cloud');
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../miniprogram/utils/planning'),catalog=require('../miniprogram/utils/catalog-migration');
const {createHandler}=require('../cloudfunctions/planningFamily/handler');
const cloudUpdate=require('./helpers/cloud-update');
const clone=x=>JSON.parse(JSON.stringify(x)),tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
function fixture({saved=[],database,role='guest',plan='used'}={}){
 const storage=new Map(saved),calls=[],gates=new Map(),failures=new Set(),lost=new Set();let urlFailure=false;
 const period=model.period(new Date('2026-10-12T12:00:00'));
 let initial=catalog.migrate(model.initial());const recipes=initial.recipes.filter(r=>!r.hidden),meat=recipes.filter(r=>r.kind==='meat').slice(0,3),veg=recipes.filter(r=>r.kind==='veg').slice(0,3);
 const lines=[...meat,...veg].map(r=>({id:r.id,multiplier:1,spice:'不辣'}));
 if(plan!=='draft'){
  initial=model.apply(initial,'guest','submit',{period,type:'next',version:0,lines},100);
  initial=model.apply(initial,'cook','confirm',{period,type:'next',version:1},200);
 }
 if(plan==='used'){
  for(const l of lines)initial=model.apply(initial,'cook','task',{period,type:'next',id:l.id,task:'cook',checked:true,version:model.getPlan(initial,'next',period).version},300);
  initial=model.apply(initial,'guest','record',{period,type:'next',id:lines[0].id,result:'吃完了',again:true,version:model.getPlan(initial,'next',period).version},400);
  initial.ledger[period.key]={test:{name:'旧采购',bought:5,actual:30}};initial.legacy.old={week:'2020-01-01',lines:[]};
 }
 initial.favorites={guest:[meat[0].id],cook:[veg[0].id]};initial.requests=[{id:'old-request',name:'旧请求',status:'待补录'}];
 initial.recipes[0].taste='自定义口味';
 const records=database||{mealFamilies:{table:{state:initial,revision:1,resetEpoch:0,code:'a'.repeat(24),members:['self','partner']}},mealIdentities:{self:{familyId:'table',role},partner:{familyId:'table',role:role==='guest'?'cook':'guest'}}};
 const collection=name=>({doc:id=>({get:async()=>{if(!records[name]?.[id])throw Error('not exist');return {data:clone(records[name][id])};},set:async({data})=>{records[name][id]=clone(data);},update:async({data})=>cloudUpdate.applyUpdate(records[name][id],data)})});
 const db={collection,command:cloudUpdate.command,runTransaction:async fn=>fn({collection})};let uid='self';
 const handler=createHandler({database:()=>db,getWXContext:()=>({OPENID:uid}),getTempFileURL:async()=>{if(urlFailure){urlFailure=false;throw Error('image URL service unavailable');}return {fileList:[]};}},{testTools:{enabled:true}});
 global.wx={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,clone(value)),switchTab(){},navigateTo(){},cloud:{callFunction:async({data:request})=>{
  const action=request.action;calls.push(clone(request));const queue=gates.get(action);if(queue&&queue.length)await queue.shift().promise;
  if(failures.delete(action))throw Error('network unavailable');
  const result=await handler(request);if(lost.delete(action))throw Error('response lost');return {result};
 }}};
 delete global.getCurrentPages;
 const path=require.resolve('../miniprogram/utils/planning-service');delete require.cache[path];const service=require(path);
 const page=name=>({route:'pages/v3-'+name+'/index',data:{busy:false,editing:null,tip:null,chooseRole:false,error:'',draftSync:{},cookSync:{},category:'全部',query:'',viewMode:'card',showSearch:false,cardIndex:0,weekDay:'',weekMeal:'午餐',view:'overview',scope:'all',expanded:'',historyType:'all',selectedKey:'',selected:null},loads:0,setData(value){Object.assign(this.data,value);},load(){this.loads++;this.state=service.state();this.data.role=service.role();this.data.plan=model.getPlan(this.state,'next',period);}});
 const menu=page('menu');
 const queueDraft=ids=>service.queueDraft(menu,{period,type:'next',lines:ids.map(id=>({id,multiplier:1,spice:'不辣'})),version:model.getPlan(service.state(),'next',period).version});
 const queueCook=id=>service.queueCook(menu,{period,type:'next',id});
 return {service,storage,calls,records,handler,period,meat,veg,lines,page,menu,queueDraft,queueCook,ready:async()=>{await service.connect(menu);},gate:action=>{const gate=deferred();if(!gates.has(action))gates.set(action,[]);gates.get(action).push(gate);return gate;},fail:action=>failures.add(action),lose:action=>lost.add(action),failURLs:()=>urlFailure=true,remoteReset:async()=>{uid='partner';const family=records.mealFamilies.table;const result=await handler({action:'resetTestData',data:{expectedResetEpoch:family.resetEpoch,expectedRevision:family.revision,requestId:'remote_reset_0001'}});uid='self';assert.equal(result.ok,true);return result;}};
}
const clean=state=>{assert.deepEqual(state.plans,{});assert.deepEqual(state.ledger,{});assert.deepEqual(state.records,[]);assert.deepEqual(state.requests,[]);assert.deepEqual(state.favorites,{guest:[],cook:[]});assert.deepEqual(state.legacy,{});assert.deepEqual(state.log,[]);};

test('清空成功只清使用数据，菜品和饭桌身份保留，所有已存在页面回初始界面',async()=>{
 const x=fixture();await x.ready();const original=clone(x.service.state().recipes),week=x.page('week'),shopping=x.page('shopping'),history=x.page('history');await x.service.connect(week);await x.service.connect(shopping);await x.service.connect(history);
 for(const p of [x.menu,week,shopping,history]){p.data.editing={form:'record'};p.data.tip={title:'旧提示'};p.data.error='旧错误';p.data.category='收藏';p.data.query='旧关键词';p.data.viewMode='list';p.data.showSearch=true;p.data.cardIndex=9;p.data.view='work';p.data.scope='next';p.data.expanded='old';p.data.historyType='next';p.data.selectedKey='old';p.swipeQueues={old:['id']};p.swipeLast={before:[{}]};p.browsePositions={old:10};}
 x.service.select('weekend',7);await x.service.resetTestData();clean(x.service.state());assert.deepEqual(x.service.state().recipes,original);assert.equal(x.service.role(),'guest');assert.equal(x.service.info().members,2);assert.equal(x.service.info().familyId,'table');assert.equal(x.service.info().resetEpoch,1);assert.equal(x.service.info().testReset.canRestore,true);assert.deepEqual(x.service.selection(),{type:'next',offset:0});
 for(const p of [x.menu,week,shopping,history]){clean(p.state);assert.equal(p.data.editing,null);assert.equal(p.data.tip,null);assert.equal(p.data.error,'');assert.equal(p.data.query,'');assert.equal(p.data.selectedKey,'');assert.deepEqual(p.swipeQueues,{});assert.equal(p.swipeLast,null);assert.deepEqual(p.browsePositions,{});}
 assert.equal(x.menu.data.viewMode,'card');assert.equal(x.menu.data.cardIndex,0);assert.equal(week.data.view,'overview');assert.equal(shopping.data.scope,'all');assert.equal(history.data.historyType,'all');assert.equal(x.storage.get(x.service.DRAFT_KEY),null);assert.equal(x.storage.get(x.service.COOK_KEY),null);
});
test('还原成功重新载入原使用数据且再换epoch，保持菜品库和身份',async()=>{
 const x=fixture();await x.ready();const before=clone(x.service.state());await x.service.resetTestData();await x.service.restoreTestData();assert.deepEqual(x.service.state(),before);assert.equal(x.service.info().resetEpoch,2);assert.equal(x.service.info().testReset.canRestore,false);assert.equal(x.service.role(),'guest');assert.deepEqual(x.menu.state,before);
});
test('点餐者清空后反复切大厨和点餐者，云端和所有菜单页面均不复活旧菜',async()=>{
 const x=fixture();await x.ready();const recipes=clone(x.service.state().recipes);await x.service.resetTestData();clean(x.records.mealFamilies.table.state);
 const week=x.page('week');
 for(let round=0;round<2;round++){
  await x.service.setRole('cook');await x.service.connect(week);clean(x.service.state());clean(week.state);assert.equal(week.data.plan.lines.length,0);assert.equal(x.service.role(),'cook');
  await x.service.setRole('guest');await x.service.connect(x.menu);clean(x.service.state());clean(x.menu.state);assert.equal(x.menu.data.plan.lines.length,0);assert.equal(x.service.role(),'guest');
 }
 await x.service.sync(true);clean(x.service.state());clean(x.records.mealFamilies.table.state);assert.deepEqual(x.service.state().recipes,recipes);assert.equal(x.service.info().testReset.canRestore,true);
 const restarted=fixture({saved:x.storage,database:x.records});await restarted.ready();clean(restarted.service.state());clean(restarted.menu.state);assert.deepEqual(restarted.service.state().recipes,recipes);assert.equal(restarted.service.role(),'guest');
});
test('另一人清空后本机直接切身份，也只能读到空菜单且清掉旧预览',async()=>{
 const x=fixture();await x.ready();await x.remoteReset();
 await x.service.setRole('cook');const week=x.page('week');await x.service.connect(week);clean(x.service.state());clean(week.state);assert.equal(x.service.info().resetEpoch,1);
 await x.service.setRole('guest');await x.service.connect(x.menu);clean(x.menu.state);
});
test('清空可丢弃失败的选菜队列，不被flushWrites卡住',async()=>{
 const x=fixture({plan:'draft'});await x.ready();x.fail('selectDraft');x.queueDraft([x.meat[0].id]);await assert.rejects(x.service.flushDraft());assert.equal(x.service.draftStatus().phase,'error');await x.service.resetTestData();clean(x.service.state());assert.equal(x.service.draftStatus().phase,'idle');assert.equal(x.calls.filter(c=>c.action==='selectDraft').length,1);
});
test('清空可丢弃制作冲突队列，恢复初始菜单后不重放做好',async()=>{
 const x=fixture({role:'cook',plan:'confirmed'});await x.ready();const gate=x.gate('task');x.queueCook(x.meat[0].id);await tick();const p=model.getPlan(x.records.mealFamilies.table.state,'next',x.period);p.lines[0].multiplier=2;p.version++;x.records.mealFamilies.table.revision++;gate.resolve();await assert.rejects(x.service.flushCook());assert.equal(x.service.cookStatus().phase,'conflict');await x.service.resetTestData();clean(x.service.state());assert.equal(x.service.cookStatus().phase,'idle');await x.service.sync(true);assert.equal(x.calls.filter(c=>c.action==='task').length,1);
});
test('断网清空失败保留当前数据、失败队列、预览和页面表单',async()=>{
 const x=fixture({plan:'draft'});await x.ready();x.fail('selectDraft');x.queueDraft([x.meat[0].id]);await assert.rejects(x.service.flushDraft());x.menu.data.editing={form:'basket'};const visible=clone(x.service.state()),queue=clone(x.storage.get(x.service.DRAFT_KEY));x.fail('resetTestData');await assert.rejects(x.service.resetTestData(),/连不上/);assert.deepEqual(x.service.state(),visible);assert.deepEqual(x.storage.get(x.service.DRAFT_KEY),queue);assert.deepEqual(x.menu.data.editing,{form:'basket'});assert.equal(x.service.draftStatus().pending,true);assert.equal(x.records.mealFamilies.table.resetEpoch,0);assert.ok(x.storage.get(x.service.RESET_KEY));
});
test('清空服务端成功但响应丢失，重试复用requestId，不覆盖原备份',async()=>{
 const x=fixture();await x.ready();const before=clone(x.service.state());x.lose('resetTestData');await assert.rejects(x.service.resetTestData());assert.deepEqual(x.service.state(),before);const backupId=x.records.mealFamilies.table.testResetBackup.backupId;assert.equal(x.records.mealFamilies.table.resetEpoch,1);await x.service.resetTestData();const requests=x.calls.filter(c=>c.action==='resetTestData');assert.equal(requests[0].data.requestId,requests[1].data.requestId);assert.equal(requests[1].data.expectedResetEpoch,0);assert.equal(x.records.mealFamilies.table.resetEpoch,1);assert.equal(x.records.mealFamilies.table.testResetBackup.backupId,backupId);clean(x.service.state());await x.service.restoreTestData();assert.deepEqual(x.service.state(),before);
});
test('清空丢失响应后重启也复用同一requestId，并能还原原始数据',async()=>{
 const x=fixture();await x.ready();const before=clone(x.service.state());x.lose('resetTestData');await assert.rejects(x.service.resetTestData());const request=x.calls.find(c=>c.action==='resetTestData'),backupId=x.records.mealFamilies.table.testResetBackup.backupId;
 const y=fixture({saved:x.storage,database:x.records});await y.ready();clean(y.service.state());await y.service.resetTestData();assert.equal(y.calls.find(c=>c.action==='resetTestData').data.requestId,request.data.requestId);assert.equal(y.records.mealFamilies.table.testResetBackup.backupId,backupId);assert.equal(y.records.mealFamilies.table.resetEpoch,1);await y.service.restoreTestData();assert.deepEqual(y.service.state(),before);
});
test('还原响应丢失后可幂等重试，失败不提前改变本机数据',async()=>{
 const x=fixture();await x.ready();const before=clone(x.service.state());await x.service.resetTestData();x.lose('restoreTestData');await assert.rejects(x.service.restoreTestData());clean(x.service.state());await x.service.restoreTestData();assert.deepEqual(x.service.state(),before);assert.equal(x.records.mealFamilies.table.resetEpoch,2);const calls=x.calls.filter(c=>c.action==='restoreTestData');assert.equal(calls[0].data.requestId,calls[1].data.requestId);
});
test('还原丢失响应后重启仍公开重试还原状态，同requestId确认后清除intent',async()=>{
 const x=fixture();await x.ready();const before=clone(x.service.state());await x.service.resetTestData();x.lose('restoreTestData');await assert.rejects(x.service.restoreTestData());const request=x.calls.find(c=>c.action==='restoreTestData');
 const y=fixture({saved:x.storage,database:x.records});await y.ready();assert.deepEqual(y.service.state(),before);assert.equal(y.service.info().testReset.canRestore,false);assert.deepEqual(y.service.testResetStatus(),{pending:true,pendingAction:'restoreTestData'});await y.service.restoreTestData();assert.equal(y.calls.find(c=>c.action==='restoreTestData').data.requestId,request.data.requestId);assert.deepEqual(y.service.testResetStatus(),{pending:false,pendingAction:''});assert.equal(y.storage.get(y.service.RESET_KEY),null);assert.equal(y.records.mealFamilies.table.resetEpoch,2);
});
test('服务端清空已提交但图片URL阶段失败，保留同id确认入口和原始备份',async()=>{
 const x=fixture();x.records.mealFamilies.table.state.recipes[0].image='cloud://env/meals/table/photo.png';await x.ready();const before=clone(x.service.state());x.failURLs();await assert.rejects(x.service.resetTestData(),/image URL/);assert.deepEqual(x.service.state(),before);assert.equal(x.records.mealFamilies.table.resetEpoch,1);assert.deepEqual(x.service.testResetStatus(),{pending:true,pendingAction:'resetTestData'});const backupId=x.records.mealFamilies.table.testResetBackup.backupId;await x.service.resetTestData();clean(x.service.state());assert.equal(x.records.mealFamilies.table.testResetBackup.backupId,backupId);assert.equal(x.records.mealFamilies.table.resetEpoch,1);const requests=x.calls.filter(c=>c.action==='resetTestData');assert.equal(requests[0].data.requestId,requests[1].data.requestId);await x.service.restoreTestData();assert.deepEqual(x.service.state(),before);
});
test('卸载页面不再刷新，重置保留菜品编辑表单而清空其使用数据',async()=>{
 const x=fixture();await x.ready();const unloaded=x.page('history'),recipe=x.page('recipe');recipe.data.r={id:'draft-recipe',name:'未保存的菜品'};await x.service.connect(unloaded);await x.service.connect(recipe);x.service.disconnect(unloaded);const loads=unloaded.loads;await x.service.resetTestData();assert.equal(unloaded.loads,loads);assert.deepEqual(recipe.data.r,{id:'draft-recipe',name:'未保存的菜品'});clean(recipe.state);
});
test('清空等待已经在途的选菜，阻止后续选菜写入并原子保留备份',async()=>{
 const x=fixture({plan:'draft'});await x.ready();const gate=x.gate('selectDraft');x.queueDraft([x.meat[0].id]);await tick();x.queueDraft([x.meat[0].id,x.meat[1].id]);const clearing=x.service.resetTestData();await tick();assert.equal(x.calls.some(c=>c.action==='resetTestData'),false);assert.throws(()=>x.queueDraft([x.veg[0].id]),/重置/);gate.resolve();await clearing;clean(x.service.state());assert.equal(x.calls.filter(c=>c.action==='selectDraft').length,1);const backup=x.records.mealFamilies.table.testResetBackup.state;assert.equal(model.getPlan(backup,'next',x.period).draftLines.length,1);assert.equal(x.service.draftStatus().pending,false);
});
test('reset期间原先等待选菜的普通写入按旧epoch拒绝，不把收藏重放到空数据',async()=>{
 const x=fixture({plan:'draft'});await x.ready();const gate=x.gate('selectDraft');x.queueDraft([x.meat[0].id]);await tick();const favorite=x.service.call('favorite',{id:x.veg[0].id});const rejection=assert.rejects(favorite,/已重置/);const clearing=x.service.resetTestData();gate.resolve();await clearing;await rejection;clean(x.service.state());assert.equal(x.calls.some(c=>c.action==='favorite'),false);
});
test('另一手机清空时，失败选菜队列可通过轮询发现新epoch并丢弃旧预览',async()=>{
 const x=fixture({plan:'draft'});await x.ready();x.fail('selectDraft');x.queueDraft([x.meat[0].id]);await assert.rejects(x.service.flushDraft());await x.remoteReset();await x.service.sync(true);clean(x.service.state());assert.equal(x.service.draftStatus().pending,false);assert.equal(x.service.draftStatus().error,'');assert.equal(x.storage.get(x.service.DRAFT_KEY),null);await x.service.retryDraft();assert.equal(x.calls.filter(c=>c.action==='selectDraft').length,1);
});
test('另一手机清空在途选菜，旧epoch被后端拒绝后自动读取新状态，不复活草稿',async()=>{
 const x=fixture({plan:'draft'});await x.ready();const gate=x.gate('selectDraft');x.queueDraft([x.meat[0].id]);await tick();await x.remoteReset();gate.resolve();await x.service.flushDraft();clean(x.service.state());assert.equal(x.service.draftStatus().phase,'idle');assert.equal(x.calls.filter(c=>c.action==='selectDraft').length,1);assert.equal(x.calls.find(c=>c.action==='selectDraft').data.expectedResetEpoch,0);
});
test('另一手机清空在途做好，旧epoch不能给新菜单写制作状态',async()=>{
 const x=fixture({role:'cook',plan:'confirmed'});await x.ready();const gate=x.gate('task');x.queueCook(x.meat[0].id);await tick();await x.remoteReset();gate.resolve();await x.service.flushCook();clean(x.service.state());assert.equal(x.service.cookStatus().phase,'idle');assert.equal(x.calls.filter(c=>c.action==='task').length,1);assert.equal(x.calls.find(c=>c.action==='task').data.expectedResetEpoch,0);
});
test('重启时不同epoch的旧outbox绝不恢复，兼容原epoch0队列',async()=>{
 const x=fixture({plan:'draft'});await x.ready();x.fail('selectDraft');x.queueDraft([x.meat[0].id]);await assert.rejects(x.service.flushDraft());await x.remoteReset();const y=fixture({saved:x.storage,database:x.records});await y.ready();clean(y.service.state());assert.equal(y.service.draftStatus().pending,false);assert.equal(y.calls.some(c=>c.action==='selectDraft'),false);assert.equal(y.storage.get(y.service.DRAFT_KEY),null);
});
test('清空后所有普通业务写入携带新epoch，保留新增数据并拒绝还原覆盖',async()=>{
 const x=fixture();await x.ready();await x.service.resetTestData();await x.service.call('request',{name:'清空后新菜'});assert.equal(x.calls.find(c=>c.action==='request').data.expectedResetEpoch,1);const before=clone(x.service.state());assert.equal(x.service.info().testReset.canRestore,false);await assert.rejects(x.service.restoreTestData(),/已有新记录/);assert.deepEqual(x.service.state(),before);assert.equal(x.storage.get(x.service.RESET_KEY),null);
});
