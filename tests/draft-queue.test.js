require('./helpers/configure-cloud');
const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../miniprogram/utils/planning'),catalog=require('../miniprogram/utils/catalog-migration');
const clone=x=>JSON.parse(JSON.stringify(x)),tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(saved){
 const store=new Map(saved||[]),calls=[],server={state:catalog.migrate(model.initial()),revision:1,role:'guest'},gates=[];let failure=null,lostResponse=false;
 const metadata=()=>({ok:true,familyId:'table-a',revision:server.revision,role:server.role,members:2,code:'a'.repeat(24)});
 global.wx={getStorageSync:key=>store.get(key),setStorageSync:(key,value)=>store.set(key,clone(value)),switchTab:()=>{},navigateTo:()=>{},cloud:{callFunction:async({data:request})=>{
  const {action,data}=request;calls.push({action,data:clone(data)});
  if(action==='get')return {result:request.revision===server.revision?{...metadata(),unchanged:true}:{...metadata(),state:clone(server.state)}};
  if(action==='role'){server.role=data.role;return {result:{...metadata(),state:clone(server.state)}};}
  if(action==='selectDraft'&&gates.length)await gates.shift().promise;
  if(failure){const error=failure;failure=null;throw error;}
  if(data.expectedRevision!==server.revision)return {result:{ok:false,error:'另一位已更新菜单，请刷新后再操作'}};
  try{server.state=model.apply(server.state,server.role,action,data);}catch(error){return {result:{ok:false,error:error.message}};}
  server.revision++;
  if(lostResponse){lostResponse=false;throw Error('response lost');}
  const result={...metadata(),state:clone(server.state)};
  if(data.compact&&action==='selectDraft'){delete result.state;result.baseRevision=data.expectedRevision;result.patch={plans:{[model.planKey(data.type,data.period)]:clone(model.getPlan(server.state,data.type,data.period))}};}
  return {result};
 }}};
 const modulePath=require.resolve('../miniprogram/utils/planning-service');delete require.cache[modulePath];const service=require(modulePath);
 const period=model.period(new Date('2026-10-12T12:00:00')),recipes=server.state.recipes.filter(r=>!r.hidden),meat=recipes.filter(r=>r.kind==='meat').slice(0,3),veg=recipes.filter(r=>r.kind==='veg').slice(0,3);
 const lines=items=>items.map(r=>({id:r.id,multiplier:1,spice:'不辣'}));
 const page={data:{busy:false},route:'pages/v3-menu/index',loads:0,setData(value){Object.assign(this.data,value);},load(){this.loads++;this.state=service.state();this.data.plan=model.getPlan(this.state,'next',period);this.data.draftSync=service.draftStatus();}};
 const queue=(items,type='next',extra={})=>service.queueDraft(page,{period,type,version:model.getPlan(service.state(),type,period).version,lines:lines(items).map(l=>type==='weekend'?{...l,day:period.sat,meal:'午餐'}:l),...extra});
 return {store,calls,server,gates,service,period,page,meat,veg,lines,queue,fail:()=>failure=Error('network unavailable'),lose:()=>lostResponse=true,ready:async()=>{await service.sync(true);page.load();}};
}
test('选菜立即预览且连续添加、取消合并为串行云端写入',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue([x.meat[0]]);assert.equal(model.getPlan(x.service.state(),'next',x.period).draftLines.length,1);assert.equal(x.page.data.busy,false);await tick();
 x.queue([x.meat[0],x.meat[1]]);x.queue([x.meat[1]]);assert.equal(model.getPlan(x.service.state(),'next',x.period).draftLines[0].id,x.meat[1].id);assert.equal(x.calls.filter(c=>c.action==='selectDraft').length,1);
 gate.resolve();await x.service.flushDraft();const mutations=x.calls.filter(c=>c.action==='selectDraft');assert.equal(mutations.length,2);assert.equal(mutations[1].data.version,1);assert.equal(mutations[1].data.expectedRevision,2);assert.deepEqual(model.getPlan(x.server.state,'next',x.period).draftLines.map(l=>l.id),[x.meat[1].id]);assert.equal(x.service.draftStatus().phase,'idle');
});
test('不同餐单互不覆盖，切 tab 和轮询保留尚未保存的选择',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue([x.meat[0]]);await tick();x.queue([x.veg[0]],'weekend');const other={...x.page,data:{busy:false},route:'pages/v3-week/index'};await x.service.connect(other);await x.service.sync(true);assert.equal(other.state.plans[model.planKey('next',x.period)].draftLines.length,1);assert.equal(other.state.plans[model.planKey('weekend',x.period)].draftLines.length,1);assert.equal(x.calls.filter(c=>c.action==='get').length,1);gate.resolve();await x.service.flushDraft();assert.equal(model.getPlan(x.server.state,'next',x.period).draftLines.length,1);assert.equal(model.getPlan(x.server.state,'weekend',x.period).draftLines.length,1);
});
test('失败保留选择、只提示同步状态，重试成功再清空待保存',async()=>{
 const x=fixture();await x.ready();x.fail();x.queue([x.meat[0]]);await assert.rejects(x.service.flushDraft(),/连不上/);assert.equal(x.service.draftStatus().phase,'error');assert.equal(x.service.draftStatus().canRetry,true);assert.equal(model.getPlan(x.service.state(),'next',x.period).draftLines.length,1);assert.equal(x.page.data.error,undefined);assert.ok(x.store.get(x.service.DRAFT_KEY));await x.service.retryDraft();assert.equal(x.service.draftStatus().pending,false);assert.equal(model.getPlan(x.server.state,'next',x.period).draftLines[0].id,x.meat[0].id);assert.equal(x.store.get(x.service.DRAFT_KEY),null);
});
test('提交等待所有选择保存后发送，转换成最新确认版本号',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue([x.meat[0]]);await tick();x.queue([...x.meat,...x.veg]);const visible=model.getPlan(x.service.state(),'next',x.period),submitting=x.service.call('submitMenu',{period:x.period,type:'next',version:visible.version});await tick();assert.equal(x.calls.some(c=>c.action==='submitMenu'),false);gate.resolve();await submitting;const mutations=x.calls.filter(c=>c.action!=='get');assert.deepEqual(mutations.map(c=>c.action),['selectDraft','selectDraft','submitMenu']);assert.equal(mutations.at(-1).data.version,2);assert.equal(model.getPlan(x.server.state,'next',x.period).status,'submitted');
});
test('选菜失败阻止提交和身份切换，不伪报成功',async()=>{
 const x=fixture();await x.ready();x.fail();x.queue([...x.meat,...x.veg]);await assert.rejects(x.service.flushDraft());const p=model.getPlan(x.service.state(),'next',x.period);await assert.rejects(x.service.call('submitMenu',{period:x.period,type:'next',version:p.version}));await assert.rejects(x.service.setRole('cook'));assert.equal(x.calls.some(c=>['submitMenu','role'].includes(c.action)),false);assert.equal(x.service.role(),'guest');
});
test('对方修改同一菜单时停队列保留草稿，显式采用最新菜单才解除冲突',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue([x.meat[0]]);await tick();x.server.state=model.apply(x.server.state,'guest','selectDraft',{period:x.period,type:'next',version:0,lines:x.lines([x.meat[1]])});x.server.revision++;gate.resolve();await assert.rejects(x.service.flushDraft(),/另一位/);assert.equal(x.service.draftStatus().phase,'conflict');assert.equal(x.service.draftStatus().canRetry,false);await assert.rejects(x.service.retryDraft(),/另一位/);assert.deepEqual(model.getPlan(x.server.state,'next',x.period).draftLines.map(l=>l.id),[x.meat[1].id]);assert.deepEqual(model.getPlan(x.service.state(),'next',x.period).draftLines.map(l=>l.id),[x.meat[0].id]);await x.service.discardDraftQueue();assert.equal(x.service.draftStatus().phase,'idle');assert.deepEqual(model.getPlan(x.service.state(),'next',x.period).draftLines.map(l=>l.id),[x.meat[1].id]);
});
test('其他餐单或收藏更新仅改变全局版本时安全刷新并继续保存',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue([x.meat[0]]);await tick();x.server.state=model.apply(x.server.state,'cook','favorite',{id:x.meat[1].id});x.server.revision++;gate.resolve();await x.service.flushDraft();assert.equal(x.service.draftStatus().phase,'idle');assert.equal(model.getPlan(x.server.state,'next',x.period).draftLines[0].id,x.meat[0].id);assert.deepEqual(x.server.state.favorites.cook,[x.meat[1].id]);
});
test('云端保存成功但响应丢失，重试识别已保存结果而不重复写入',async()=>{
 const x=fixture();await x.ready();x.lose();x.queue([x.meat[0]]);await assert.rejects(x.service.flushDraft());assert.equal(x.server.revision,2);await x.service.retryDraft();assert.equal(x.service.draftStatus().pending,false);assert.equal(x.server.revision,2);assert.equal(x.calls.filter(c=>c.action==='selectDraft').length,1);
});
test('待同步草稿跨重启恢复，且新的云端冲突不会被静默覆盖',async()=>{
 const x=fixture();await x.ready();x.fail();x.queue([x.meat[0]]);await assert.rejects(x.service.flushDraft());const y=fixture(x.store);y.server.state=clone(x.server.state);y.server.revision=x.server.revision;await y.ready();await y.service.flushDraft();assert.equal(model.getPlan(y.server.state,'next',y.period).draftLines[0].id,y.meat[0].id);assert.equal(y.service.draftStatus().pending,false);
});
test('本地模式仍同步选菜和提交，不依赖云端队列',()=>{
 const store=new Map();global.wx={getStorageSync:key=>store.get(key),setStorageSync:(key,value)=>store.set(key,clone(value))};const modulePath=require.resolve('../miniprogram/utils/planning-service');delete require.cache[modulePath];const s=require(modulePath);s.setRole('guest');const period=model.period(),items=s.state().recipes.filter(r=>!r.hidden);const selected=['meat','veg'].flatMap(kind=>items.filter(r=>r.kind===kind).slice(0,3)).map(r=>({id:r.id,multiplier:1,spice:'不辣'}));const queued=s.queueDraft(null,{period,type:'next',version:0,lines:selected});assert.equal(queued.then,undefined);assert.equal(s.flushDraft().then,undefined);const done=s.call('submitMenu',{period,type:'next',version:1});assert.equal(model.getPlan(done,'next',period).status,'submitted');assert.equal(s.draftStatus().pending,false);
});
test('保存稍慢仅更新后台slow状态，快保存不进入慢状态',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue([x.meat[0]]);assert.equal(x.service.draftStatus().slow,false);await new Promise(resolve=>setTimeout(resolve,625));assert.equal(x.service.draftStatus().slow,true);assert.equal(x.page.data.draftSync.slow,true);gate.resolve();await x.service.flushDraft();assert.equal(x.service.draftStatus().slow,false);
});
test('重启恢复发现对方菜单已变更时保留本机意图并停为冲突',async()=>{
 const x=fixture();await x.ready();x.fail();x.queue([x.meat[0]]);await assert.rejects(x.service.flushDraft());const y=fixture(x.store);y.server.state=model.apply(y.server.state,'guest','selectDraft',{period:y.period,type:'next',version:0,lines:y.lines([y.meat[1]])});y.server.revision++;await y.ready();assert.equal(y.service.draftStatus().phase,'conflict');await assert.rejects(y.service.flushDraft(),/另一位/);assert.equal(y.calls.some(c=>c.action==='selectDraft'),false);assert.deepEqual(model.getPlan(y.service.state(),'next',y.period).draftLines.map(l=>l.id),[y.meat[0].id]);await y.service.discardDraftQueue();
});
test('恢复时身份变化可显式切回点餐者再保存原有意图',async()=>{
 const x=fixture();await x.ready();x.fail();x.queue([x.meat[0]]);await assert.rejects(x.service.flushDraft());const y=fixture(x.store);y.server.role='cook';await y.ready();assert.equal(y.service.draftStatus().phase,'error');await y.service.setRole('guest');assert.equal(y.service.draftStatus().phase,'idle');assert.equal(y.service.role(),'guest');assert.equal(model.getPlan(y.server.state,'next',y.period).draftLines[0].id,y.meat[0].id);
});
test('收藏与选菜共用串行屏障，收藏不越过尚未保存的选择',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue([x.meat[0]]);await tick();const favorite=x.service.call('favorite',{id:x.meat[1].id});await tick();assert.equal(x.calls.some(c=>c.action==='favorite'),false);gate.resolve();await favorite;assert.deepEqual(x.server.state.favorites.guest,[x.meat[1].id]);assert.deepEqual(model.getPlan(x.server.state,'next',x.period).draftLines.map(l=>l.id),[x.meat[0].id]);assert.equal(x.calls.filter(c=>c.action==='favorite')[0].data.expectedRevision,2);
});
test('收藏等待期间仍可继续挑菜，后续选择先保存再写收藏',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue([x.meat[0]]);await tick();const favorite=x.service.call('favorite',{id:x.veg[0].id});x.queue([x.meat[0],x.meat[1]]);gate.resolve();await favorite;assert.deepEqual(model.getPlan(x.server.state,'next',x.period).draftLines.map(l=>l.id),x.meat.slice(0,2).map(r=>r.id));assert.deepEqual(x.calls.filter(c=>c.action!=='get').map(c=>c.action),['selectDraft','selectDraft','favorite']);
});
test('之前正在执行的云端刷新先结束，发现菜单变化后不发送旧选择',async()=>{
 const x=fixture();await x.ready();const readGate=deferred(),original=wx.cloud.callFunction;let gateNextGet=true;wx.cloud.callFunction=async args=>{if(gateNextGet&&args.data.action==='get'){gateNextGet=false;await readGate.promise;}return original(args);};
 const refresh=x.service.sync(true);await tick();x.queue([x.meat[0]]);await tick();assert.equal(x.calls.some(c=>c.action==='selectDraft'),false);x.server.state=model.apply(x.server.state,'guest','selectDraft',{period:x.period,type:'next',version:0,lines:x.lines([x.meat[1]])});x.server.revision++;readGate.resolve();await refresh;await assert.rejects(x.service.flushDraft(),/另一位/);assert.equal(x.calls.some(c=>c.action==='selectDraft'),false);await x.service.discardDraftQueue();
});
test('响应丢失重试不把图片临时地址变化当作菜单冲突',async()=>{
 const x=fixture();x.server.state=model.apply(x.server.state,'guest','submit',{period:x.period,type:'next',version:0,lines:x.lines([...x.meat,...x.veg])});const key=model.planKey('next',x.period);x.server.state.plans[key].recipes[0].displayImage='https://old.test/temp';await x.ready();x.lose();x.queue([...x.meat,...x.veg]);await assert.rejects(x.service.flushDraft());x.server.state.plans[key].recipes[0].displayImage='https://new.test/temp';await x.service.retryDraft();assert.equal(x.service.draftStatus().pending,false);assert.equal(x.server.revision,2);
});
test('重启后识别已保存且响应丢失的草稿，恢复实际版本并不重复保存',async()=>{
 const x=fixture();await x.ready();x.lose();x.queue([x.meat[0]]);await assert.rejects(x.service.flushDraft());const y=fixture(x.store);y.server.state=clone(x.server.state);y.server.revision=x.server.revision;await y.service.connect(y.page);await y.service.flushDraft();assert.equal(y.service.draftStatus().pending,false);assert.equal(model.getPlan(y.service.state(),'next',y.period).version,model.getPlan(y.server.state,'next',y.period).version);assert.equal(y.page.data.plan.version,1);assert.equal(y.calls.some(c=>c.action==='selectDraft'),false);
});
