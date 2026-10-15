require('./helpers/configure-cloud');
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../cloudfunctions/planningFamily/handler');
const model=require('../cloudfunctions/planningFamily/planning');
const {command,applyUpdate}=require('./helpers/cloud-update');
const copy=structuredClone;

function server(enabled=true){
 const store={},testTools={enabled},images={failures:0,calls:0};let uid='a';
 const collection=name=>({
  doc:id=>({
   get:async()=>{if(!store[name]?.[id])throw Error('not exist');return {data:copy(store[name][id])};},
   set:async({data})=>{store[name][id]=copy(data);},
   update:async({data})=>applyUpdate(store[name][id],data)
  }),
  where:query=>({limit:()=>({get:async()=>({data:Object.entries(store[name]||{}).filter(([,value])=>value.code===query.code).map(([id,value])=>({...copy(value),_id:id}))})})})
 });
 let lock=Promise.resolve();
 const db={command,collection,createCollection:async name=>{if(store[name])throw Error('already exist');store[name]={};},runTransaction:fn=>{const operation=lock.then(()=>fn({collection}));lock=operation.catch(()=>{});return operation;}};
 const handler=createHandler({database:()=>db,getWXContext:()=>({OPENID:uid}),getTempFileURL:async({fileList})=>{images.calls++;if(images.failures>0){images.failures--;throw Error('图片地址暂时不可用');}return {fileList:fileList.map(fileID=>({fileID,tempFileURL:'https://example.test/recipe.jpg',status:0}))};}},{testTools});
 return {store,testTools,images,handler,as:value=>uid=value};
}
async function fixture(enabled=true){
 const x=server(enabled),created=await x.handler({action:'create',data:{role:'guest'}});
 x.as('b');const joined=await x.handler({action:'join',data:{code:created.code,role:'cook'}});x.as('a');
 const family=x.store.mealFamilies[created.familyId],id=family.state.recipes[0].id;
 family.state={...family.state,
  recipes:[{...family.state.recipes[0],name:'已整理的自定义菜',hidden:true},...family.state.recipes.slice(1)],
  catalogArchive:[{id:'archived-custom',name:'归档菜',image:'/assets/archive.jpg'}],
  plans:{'next:2026-10-19':{key:'next:2026-10-19',lines:[{id,tasks:{cook:true}}],status:'cooked',version:5}},
  ledger:{'2026-10-17':{rice:{bought:3,stock:1,actual:20,checklistStatus:'bought'}}},
  favorites:{guest:[id],cook:[id]},requests:[{id:'req1',name:'新菜'}],
  records:[{key:'next:2026-10-19',recipeId:id,again:true}],legacy:{old:{lines:[{id}]}},log:[{message:'提交菜单'}],
  extraUsage:{cachedStats:{cooked:1}}
 };
 const before=copy(family),reset=(requestId='reset-request-0001',overrides={})=>x.handler({action:'resetTestData',data:{requestId,expectedRevision:family.revision,expectedResetEpoch:family.resetEpoch||0,...overrides}});
 const restore=(requestId='restore-request-0001',overrides={})=>x.handler({action:'restoreTestData',data:{requestId,expectedRevision:family.revision,expectedResetEpoch:family.resetEpoch||0,...overrides}});
 return {...x,family,id,before,reset,restore,created,joined};
}

test('清空只移除使用记录，保留原菜品库、归档库、饭桌身份和邀请码',async()=>{
 const x=await fixture(),r=await x.reset();assert.equal(r.ok,true);assert.equal(r.resetEpoch,1);assert.equal(r.revision,x.before.revision+1);
 assert.deepEqual(r.state.recipes,x.before.state.recipes);assert.equal(r.state.catalogVersion,x.before.state.catalogVersion);assert.deepEqual(r.state.catalogArchive,x.before.state.catalogArchive);assert.equal(r.state.schema,x.before.state.schema);
 for(const key of ['plans','ledger','legacy'])assert.deepEqual(r.state[key],{});
 for(const key of ['requests','records','log'])assert.deepEqual(r.state[key],[]);
 assert.deepEqual(r.state.favorites,{guest:[],cook:[]});assert.equal(r.state.extraUsage,undefined);
 assert.equal(r.code,x.before.code);assert.deepEqual(x.family.members,x.before.members);assert.deepEqual(x.store.mealIdentities,{a:{familyId:r.familyId,role:'guest'},b:{familyId:r.familyId,role:'cook'}});
 assert.deepEqual(x.family.testResetBackup.state,x.before.state);assert.equal(x.family.testResetBackup.resetRevision,r.revision);
 assert.equal(r.testReset.enabled,true);assert.equal(r.testReset.canRestore,true);assert.match(r.testReset.backupId,/^[a-f0-9]{32}$/);assert.ok(r.testReset.resetAt>0);
 assert.equal(r.testResetBackup,undefined);assert.equal(JSON.stringify(r).includes('"uid"'),false);
});
test('清空后云端嵌套记录确实删除，点餐者与大厨反复切换及重新读取都不会复活',async()=>{
 const x=await fixture(),reset=await x.reset();assert.equal(reset.ok,true);
 const empty=copy(reset.state);
 assert.deepEqual(x.family.state,empty);
 assert.deepEqual(x.family.state.plans,{});assert.deepEqual(x.family.state.ledger,{});assert.deepEqual(x.family.state.legacy,{});assert.equal(x.family.state.extraUsage,undefined);
 for(const role of ['cook','guest','cook','guest']){
  const response=await x.handler({action:'role',data:{role,expectedResetEpoch:reset.resetEpoch}});
  assert.equal(response.ok,true);assert.equal(response.role,role);assert.equal(response.resetEpoch,reset.resetEpoch);assert.deepEqual(response.state,empty);
 }
 x.as('b');const partner=await x.handler({action:'get'});assert.equal(partner.ok,true);assert.deepEqual(partner.state,empty);
 const restarted=createHandler({database:()=>({command,collection:name=>({doc:id=>({get:async()=>({data:copy(x.store[name][id])})})})}),getWXContext:()=>({OPENID:'a'}),getTempFileURL:async()=>({fileList:[]})},{testTools:{enabled:true}});
 const response=await restarted({action:'get'});assert.equal(response.ok,true);assert.deepEqual(response.state,empty);
});
test('每次备份整体替换，恢复与原快照精确一致，不继承前次备份嵌套字段',async()=>{
 const x=await fixture();await x.reset();
 const first=copy(x.family.testResetBackup.state);
 x.family.state={...copy(first),plans:{},ledger:{},legacy:{},log:[],records:[],requests:[{id:'new-request',name:'第二次记录'}]};delete x.family.state.extraUsage;
 x.family.revision++;const expected=copy(x.family.state);
 const second=await x.reset('reset-new-snapshot-0002');assert.equal(second.ok,true);assert.deepEqual(x.family.testResetBackup.state,expected);
 const restored=await x.restore();assert.equal(restored.ok,true);assert.deepEqual(restored.state,expected);assert.deepEqual(x.family.state,expected);assert.equal(x.family.state.extraUsage,undefined);
 const read=await x.handler({action:'get'});assert.deepEqual(read.state,expected);
});
test('重新提交从云端彻底删除修改草稿及旧确认字段，切换身份后保持已提交状态',async()=>{
 const x=server(),created=await x.handler({action:'create',data:{role:'guest'}}),family=x.store.mealFamilies[created.familyId],period=model.period(new Date('2026-10-12T12:00:00'));
 const lines=['meat','veg'].flatMap(kind=>family.state.recipes.filter(r=>r.kind===kind&&!r.hidden).slice(0,3)).map(r=>({id:r.id,multiplier:1,spice:'不辣'}));
 const call=(action,data={})=>x.handler({action,data:{period,type:'next',version:model.getPlan(family.state,'next',period).version,expectedRevision:family.revision,expectedResetEpoch:family.resetEpoch,...data}});
 assert.equal((await call('selectDraft',{lines})).ok,true);assert.equal((await call('submitMenu')).ok,true);
 assert.equal((await call('role',{role:'cook'})).ok,true);assert.equal((await call('confirm')).ok,true);
 family.state.plans[model.planKey('next',period)].suggestion='旧调整建议';
 assert.equal((await call('role',{role:'guest'})).ok,true);assert.equal((await call('startEdit')).ok,true);
 const confirmed=copy(model.getPlan(family.state,'next',period)),same=await call('submitMenu');assert.equal(same.ok,true);
 for(const state of [same.state,family.state,(await x.handler({action:'get'})).state]){
  const plan=model.getPlan(state,'next',period);assert.equal(plan.status,'confirmed');assert.equal(plan.confirmedAt,confirmed.confirmedAt);assert.equal(plan.submittedAt,confirmed.submittedAt);assert.equal(plan.suggestion,'旧调整建议');assert.equal(plan.draftLines,undefined);assert.equal(plan.draftIntent,undefined);
 }
 assert.equal((await call('startEdit')).ok,true);assert.equal((await call('selectDraft',{lines:lines.map((line,i)=>i?line:{...line,spice:'少辣'})})).ok,true);
 const submitted=await call('submitMenu');assert.equal(submitted.ok,true);
 for(const state of [submitted.state,family.state,(await x.handler({action:'get'})).state,(await call('role',{role:'cook'})).state]){
  const plan=model.getPlan(state,'next',period);assert.equal(plan.status,'submitted');assert.equal(plan.draftLines,undefined);assert.equal(plan.draftIntent,undefined);assert.equal(plan.confirmedAt,undefined);assert.equal(plan.suggestion,undefined);assert.equal(plan.lines.length,6);assert.equal(plan.lines[0].spice,'少辣');
 }
});
test('放弃修改后云端删除draftLines，刷新不会重新进入修改模式',async()=>{
 const x=server(),created=await x.handler({action:'create',data:{role:'guest'}}),family=x.store.mealFamilies[created.familyId],period=model.period(new Date('2026-10-12T12:00:00'));
 const lines=['meat','veg'].flatMap(kind=>family.state.recipes.filter(r=>r.kind===kind&&!r.hidden).slice(0,3)).map(r=>({id:r.id,multiplier:1,spice:'不辣'}));
 const call=(action,data={})=>x.handler({action,data:{period,type:'next',version:model.getPlan(family.state,'next',period).version,expectedRevision:family.revision,expectedResetEpoch:family.resetEpoch,...data}});
 assert.equal((await call('selectDraft',{lines})).ok,true);assert.equal((await call('submitMenu')).ok,true);assert.equal((await call('startEdit')).ok,true);
 assert.equal((await call('discardDraft')).ok,true);
 const read=await x.handler({action:'get'});assert.equal(model.getPlan(read.state,'next',period).draftLines,undefined);assert.equal(model.getPlan(family.state,'next',period).draftLines,undefined);assert.equal(model.getPlan(read.state,'next',period).lines.length,6);
});
test('双方饭桌成员均可清空，完全不影响另一张饭桌',async()=>{
 const x=await fixture();x.as('c');const other=await x.handler({action:'create',data:{role:'cook'}}),snapshot=copy(x.store.mealFamilies[other.familyId]);
 x.as('b');assert.equal((await x.reset()).ok,true);assert.deepEqual(x.store.mealFamilies[other.familyId],snapshot);assert.equal(x.store.mealIdentities.c.familyId,other.familyId);
});
test('伪造饭桌身份但不在members内的用户无法清空或还原',async()=>{
 const x=await fixture(),before=copy(x.family);x.store.mealIdentities.c={familyId:x.created.familyId,role:'cook'};x.as('c');
 for(const action of ['resetTestData','restoreTestData']){const r=await x.handler({action,data:{requestId:'unauthorized-0001',expectedRevision:x.family.revision,expectedResetEpoch:0}});assert.equal(r.ok,false);assert.match(r.error,/无权/);}
 assert.deepEqual(x.family,before);
});
test('未加入饭桌的请求不会创建或修改任何饭桌',async()=>{
 const x=await fixture(),before=copy(x.store);x.as('unbound');const r=await x.reset();assert.equal(r.unbound,true);assert.deepEqual(x.store,before);
});
test('关闭开关时清空、还原及幂等重试都不可执行',async()=>{
 const x=await fixture(false),before=copy(x.family);assert.equal((await x.reset()).ok,false);assert.deepEqual(x.family,before);
 const get=await x.handler({action:'get'});assert.deepEqual(get.testReset,{enabled:false,canRestore:false,resetAt:null,backupId:null});
 x.testTools.enabled=true;assert.equal((await x.reset()).ok,true);const resetFamily=copy(x.family);x.testTools.enabled=false;
 for(const r of [await x.reset(),await x.restore()]){assert.equal(r.ok,false);assert.match(r.error,/关闭/);}
 assert.deepEqual(x.family,resetFamily);
});
test('清空要求当前revision，旧revision不能覆盖对方刚写入的数据',async()=>{
 const x=await fixture(),before=copy(x.family),r=await x.reset('reset-stale-revision',{expectedRevision:x.family.revision-1});
 assert.equal(r.ok,false);assert.match(r.error,/另一位/);assert.deepEqual(x.family,before);
});
test('清空要求epoch，即使初始为0也拒绝缺失、字符串或错误epoch',async()=>{
 for(const value of [undefined,'0',1]){const x=await fixture(),before=copy(x.family),r=await x.reset('reset-invalid-epoch',{expectedResetEpoch:value});assert.equal(r.ok,false);assert.equal(r.code,'RESET_EPOCH_CHANGED');assert.equal(r.resetEpoch,0);assert.deepEqual(x.family,before);}
});
test('缺失或不合规requestId被拒绝，合法重试id不能改成另一种操作',async()=>{
 for(const id of ['',undefined,'short','reset/request/invalid','a'.repeat(101),1234567890123456]){const x=await fixture(),before=copy(x.family),r=await x.reset('unused-request-0001',{requestId:id});assert.equal(r.ok,false);assert.deepEqual(x.family,before);}
 const x=await fixture();assert.equal((await x.reset()).ok,true);const before=copy(x.family),r=await x.restore('reset-request-0001');assert.equal(r.ok,false);assert.match(r.error,/其他操作/);assert.deepEqual(x.family,before);
});
test('响应丢失后reset用原requestId和原revision/epoch重试不替换原备份',async()=>{
 const x=await fixture(),input={action:'resetTestData',data:{requestId:'reset-lost-ack-0001',expectedRevision:x.family.revision,expectedResetEpoch:0}};
 const first=await x.handler(input),before=copy(x.family),second=await x.handler(input);assert.equal(second.ok,true);assert.deepEqual(second,first);assert.deepEqual(x.family,before);assert.deepEqual(x.family.testResetBackup.state,x.before.state);
});
test('已经清空后反复点清空会保留原非空备份，仍可还原原记录',async()=>{
 const x=await fixture(),first=await x.reset();
 for(const requestId of ['reset-repeat-empty-0002','reset-repeat-empty-0003']){
  const previousRevision=x.family.revision,previousEpoch=x.family.resetEpoch,repeated=await x.reset(requestId);
  assert.equal(repeated.ok,true);assert.equal(repeated.revision,previousRevision+1);assert.equal(repeated.resetEpoch,previousEpoch+1);
  assert.equal(repeated.testReset.canRestore,true);assert.equal(repeated.testReset.backupId,first.testReset.backupId);assert.equal(repeated.testReset.resetAt,first.testReset.resetAt);
  assert.deepEqual(x.family.testResetBackup.state,x.before.state);assert.equal(x.family.testResetBackup.resetRevision,repeated.revision);
 }
 const restored=await x.restore();assert.equal(restored.ok,true);assert.deepEqual(restored.state,x.before.state);assert.equal(restored.resetEpoch,4);
});
test('重置后新请求需要新epoch，旧客户端及旧队列不能把数据写回来',async()=>{
 const x=await fixture();assert.equal((await x.reset()).ok,true);const before=copy(x.family);
 for(const epoch of [undefined,0]){const r=await x.handler({action:'favorite',data:{id:x.id,expectedRevision:x.family.revision,expectedResetEpoch:epoch}});assert.equal(r.ok,false);assert.equal(r.code,'RESET_EPOCH_CHANGED');assert.equal(r.resetEpoch,1);}
 assert.deepEqual(x.family,before);
 const valid=await x.handler({action:'favorite',data:{id:x.id,expectedRevision:x.family.revision,expectedResetEpoch:1,compact:true}});assert.equal(valid.ok,true);assert.deepEqual(valid.patch.favorites.guest,[x.id]);assert.equal(valid.resetEpoch,1);assert.equal(valid.testReset.canRestore,false);
});
test('首次重置前保留现有客户端普通写入兼容',async()=>{
 const x=await fixture();const r=await x.handler({action:'request',data:{name:'仍兼容旧体验版',expectedRevision:x.family.revision}});assert.equal(r.ok,true);assert.equal(r.resetEpoch,0);
});
test('重置后立刻还原可恢复完全相同的使用数据，revision与epoch继续增长',async()=>{
 const x=await fixture(),reset=await x.reset(),r=await x.restore();assert.equal(r.ok,true);assert.deepEqual(r.state,x.before.state);assert.equal(r.revision,reset.revision+1);assert.equal(r.resetEpoch,2);assert.equal(r.testReset.canRestore,false);assert.equal(r.testReset.backupId,null);assert.equal(x.family.testResetBackup,null);
 assert.equal((await x.restore('restore-again-0002')).ok,false);
});
test('切换身份不改变饭桌revision，不妨碍还原，且还原保留新身份',async()=>{
 const x=await fixture();const reset=await x.reset();x.as('b');const role=await x.handler({action:'role',data:{role:'guest'}});assert.equal(role.revision,reset.revision);assert.equal(role.testReset.canRestore,true);
 const restored=await x.restore();assert.equal(restored.ok,true);assert.equal(restored.role,'guest');assert.equal(x.store.mealIdentities.b.role,'guest');assert.deepEqual(restored.state,x.before.state);
});
test('清空后已有新记录时禁止还原覆盖，即使请求使用最新revision',async()=>{
 const x=await fixture();await x.reset();const write=await x.handler({action:'request',data:{name:'清空后的新菜',expectedRevision:x.family.revision,expectedResetEpoch:1}});assert.equal(write.ok,true);assert.equal(write.testReset.canRestore,false);
 const before=copy(x.family),r=await x.restore();assert.equal(r.ok,false);assert.match(r.error,/已有新记录/);assert.deepEqual(x.family,before);
});
test('还原也要求当前revision与epoch，并且缺失备份时不产生写入',async()=>{
 const x=await fixture(),before=copy(x.family);assert.equal((await x.restore()).ok,false);assert.deepEqual(x.family,before);await x.reset();const resetFamily=copy(x.family);
 assert.equal((await x.restore('restore-old-revision',{expectedRevision:x.family.revision-1})).ok,false);
 const epoch=await x.restore('restore-old-epoch-0001',{expectedResetEpoch:0});assert.equal(epoch.code,'RESET_EPOCH_CHANGED');assert.deepEqual(x.family,resetFamily);
});
test('restore响应丢失的重试不再次还原或增加版本',async()=>{
 const x=await fixture();await x.reset();const input={action:'restoreTestData',data:{requestId:'restore-lost-ack-0001',expectedRevision:x.family.revision,expectedResetEpoch:1}};
 const first=await x.handler(input),before=copy(x.family),retry=await x.handler(input);assert.equal(retry.ok,true);assert.deepEqual(retry,first);assert.deepEqual(x.family,before);
});
test('旧reset的幂等重试在后续新写入和restore后也不会再次清空',async()=>{
 const x=await fixture(),input={action:'resetTestData',data:{requestId:'reset-late-retry-0001',expectedRevision:x.family.revision,expectedResetEpoch:0}};await x.handler(input);await x.restore();
 const write=await x.handler({action:'request',data:{name:'还原后的新请求',expectedRevision:x.family.revision,expectedResetEpoch:2}});assert.equal(write.ok,true);const before=copy(x.family),retry=await x.handler(input);assert.equal(retry.ok,true);assert.deepEqual(retry.state,x.family.state);assert.deepEqual(x.family,before);
});
test('两位成员的相同requestId不共用权限或备份：过期第二个请求被拒绝',async()=>{
 const x=await fixture(),request={action:'resetTestData',data:{requestId:'reset-shared-id-0001',expectedRevision:x.family.revision,expectedResetEpoch:0}};await x.handler(request);const before=copy(x.family);x.as('b');const r=await x.handler(request);assert.equal(r.ok,false);assert.equal(r.code,'RESET_EPOCH_CHANGED');assert.deepEqual(x.family,before);
});
test('并发重复reset只执行一次，另一成员同时旧epoch写入也被拒绝',async()=>{
 const x=await fixture(),input={action:'resetTestData',data:{requestId:'reset-concurrent-0001',expectedRevision:x.family.revision,expectedResetEpoch:0}};
 const first=x.handler(input),second=x.handler(input);x.as('b');const stale=x.handler({action:'favorite',data:{id:x.id,expectedRevision:x.family.revision,expectedResetEpoch:0}});
 const responses=await Promise.all([first,second,stale]);assert.ok(responses.slice(0,2).every(r=>r.ok));assert.equal(responses[2].code,'RESET_EPOCH_CHANGED');assert.equal(x.family.revision,x.before.revision+1);assert.equal(x.family.resetEpoch,1);assert.equal(x.family.testResetRequests.length,1);
});
test('无变化轮询同样返回epoch和可恢复元数据，但不会暴露备份或成员ID',async()=>{
 const x=await fixture(),r=await x.reset(),get=await x.handler({action:'get',revision:r.revision});assert.equal(get.unchanged,true);assert.equal(get.state,undefined);assert.equal(get.resetEpoch,1);assert.deepEqual(get.testReset,r.testReset);assert.equal(get.testResetBackup,undefined);assert.equal(JSON.stringify(get).includes('"uid"'),false);
});
test('确定的事务前校验拒绝有明确code，普通菜单冲突仍保持原协议',async()=>{
 const x=await fixture();
 const stale=await x.reset('reset-precommit-stale',{expectedRevision:x.family.revision-1});assert.equal(stale.code,'TEST_RESET_REJECTED');
 const invalid=await x.reset('short');assert.equal(invalid.code,'TEST_RESET_REJECTED');
 const noBackup=await x.restore();assert.equal(noBackup.code,'TEST_RESET_REJECTED');
 const ordinary=await x.handler({action:'favorite',data:{id:x.id,expectedRevision:x.family.revision-1}});assert.equal(ordinary.code,undefined);
 x.testTools.enabled=false;const closed=await x.reset();assert.equal(closed.code,'TEST_RESET_REJECTED');
});
test('reset提交后图片地址失败不能当作确定拒绝，同ID重试确认原备份',async()=>{
 const x=await fixture();x.family.state.recipes[0].image='cloud://test/meals/photo.jpg';const original=copy(x.family.state),revision=x.family.revision;
 const input={action:'resetTestData',data:{requestId:'reset-url-lost-ack-0001',expectedRevision:revision,expectedResetEpoch:0}};
 x.images.failures=1;const failed=await x.handler(input);assert.equal(failed.ok,false);assert.equal(failed.code,undefined);assert.equal(x.family.revision,revision+1);assert.deepEqual(x.family.testResetBackup.state,original);
 const backup=copy(x.family.testResetBackup),retry=await x.handler(input);assert.equal(retry.ok,true);assert.equal(retry.revision,revision+1);assert.equal(retry.resetEpoch,1);assert.deepEqual(x.family.testResetBackup,backup);assert.equal(retry.state.recipes[0].displayImage,'https://example.test/recipe.jpg');
});
test('restore提交后图片地址失败仍可同ID重试确认，不会二次消费备份',async()=>{
 const x=await fixture();await x.reset();x.family.testResetBackup.state.recipes[0].image='cloud://test/meals/restored-photo.jpg';const original=copy(x.family.testResetBackup.state),revision=x.family.revision;
 const input={action:'restoreTestData',data:{requestId:'restore-url-lost-ack-0001',expectedRevision:revision,expectedResetEpoch:1}};
 x.images.failures=1;const failed=await x.handler(input);assert.equal(failed.ok,false);assert.equal(failed.code,undefined);assert.equal(x.family.revision,revision+1);assert.equal(x.family.testResetBackup,null);assert.deepEqual(x.family.state,original);
 const retry=await x.handler(input);assert.equal(retry.ok,true);assert.equal(retry.revision,revision+1);assert.equal(retry.resetEpoch,2);assert.equal(retry.testReset.canRestore,false);assert.equal(x.family.testResetBackup,null);assert.deepEqual(x.family.state,original);
});
