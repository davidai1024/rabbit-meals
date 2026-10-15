require('./helpers/configure-cloud');
const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../miniprogram/utils/planning'),catalog=require('../miniprogram/utils/catalog-migration');
const clone=x=>JSON.parse(JSON.stringify(x)),tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(saved,options={}){
 const store=new Map(saved||[]),calls=[],server={state:catalog.migrate(model.initial()),revision:1,role:options.role||'cook',familyId:options.familyId||'table-a'},gates=[];let failure=false,lostResponse=false;
 const period=model.period(new Date('2026-10-12T12:00:00')),recipes=server.state.recipes.filter(r=>!r.hidden),meat=recipes.filter(r=>r.kind==='meat').slice(0,3),veg=recipes.filter(r=>r.kind==='veg').slice(0,3);
 const lines=items=>items.map(r=>({id:r.id,multiplier:1,spice:'不辣'}));
 for(const type of ['next','weekend']){server.state=model.apply(server.state,'guest','submit',{period,type,version:0,lines:lines(type==='next'?[...meat,...veg]:meat.slice(0,2)).map(l=>type==='weekend'?{...l,day:period.sat,meal:'午餐'}:l)},100);server.state=model.apply(server.state,'cook','confirm',{period,type,version:1},200);}
 const metadata=()=>({ok:true,familyId:server.familyId,revision:server.revision,role:server.role,members:2,code:'a'.repeat(24)});
 global.wx={getStorageSync:key=>store.get(key),setStorageSync:(key,value)=>store.set(key,clone(value)),switchTab:()=>{},navigateTo:()=>{},cloud:{callFunction:async({data:request})=>{
  const {action,data}=request;calls.push({action,data:clone(data)});
  if(action==='get')return {result:request.revision===server.revision?{...metadata(),unchanged:true}:{...metadata(),state:clone(server.state)}};
  if(action==='role'){server.role=data.role;return {result:{...metadata(),state:clone(server.state)}};}
  if(action==='task'&&data.task==='cook'&&gates.length)await gates.shift().promise;
  if(failure){failure=false;throw Error('network unavailable');}
  if(data.expectedRevision!==server.revision)return {result:{ok:false,error:'另一位已更新菜单，请刷新后再操作'}};
  try{server.state=model.apply(server.state,server.role,action,data);}catch(error){return {result:{ok:false,error:error.message}};}
  server.revision++;
  if(lostResponse){lostResponse=false;throw Error('response lost');}
  const result={...metadata(),state:clone(server.state)};
  if(data.compact&&action==='task'){delete result.state;result.baseRevision=data.expectedRevision;result.patch={plans:{[model.planKey(data.type,data.period)]:clone(model.getPlan(server.state,data.type,data.period))}};}
  return {result};
 }}};
 const modulePath=require.resolve('../miniprogram/utils/planning-service');delete require.cache[modulePath];const service=require(modulePath);
 const page={data:{busy:false},route:'pages/v3-cook/index',loads:0,setData(value){Object.assign(this.data,value);},load(){this.loads++;this.state=service.state();this.data.plan=model.getPlan(this.state,'next',period);this.data.cookSync=service.cookStatus();}};
 const queue=(id=meat[0].id,type='next',otherPeriod=period)=>service.queueCook(page,{period:otherPeriod,type,id});
 const cooked=(state=service.state(),type='next')=>model.getPlan(state,type,period).lines.filter(l=>(l.tasks||{}).cook).map(l=>l.id);
 return {store,calls,server,gates,service,period,page,meat,veg,lines,queue,cooked,fail:()=>failure=true,lose:()=>lostResponse=true,ready:async()=>{await service.sync(true);page.load();}};
}
test('做好立即更新且可连续点不同菜，不全页置灰，每次写入用最新版本',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);const state=x.queue();assert.equal(state.then,undefined);assert.deepEqual(x.cooked(),[x.meat[0].id]);assert.equal(x.page.data.busy,false);await tick();x.queue(x.meat[1].id);x.queue(x.veg[0].id);assert.deepEqual(x.cooked(),[x.meat[0].id,x.meat[1].id,x.veg[0].id]);assert.equal(x.calls.filter(c=>c.action==='task').length,1);gate.resolve();await x.service.flushCook();const mutations=x.calls.filter(c=>c.action==='task');assert.deepEqual(mutations.map(c=>c.data.version),[2,3,4]);assert.deepEqual(mutations.map(c=>c.data.expectedRevision),[1,2,3]);assert.ok(mutations.every(c=>c.data.task==='cook'&&c.data.checked===true));assert.deepEqual(x.cooked(x.server.state),x.cooked());assert.equal(x.service.cookStatus().phase,'idle');
});
test('同一道菜双击和已保存后再次点击都幂等，不重复制作统计',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue();await tick();x.queue();x.queue();assert.equal(x.service.cookStatus().count,1);assert.equal(model.stats(x.service.state()).cooked,1);gate.resolve();await x.service.flushCook();x.queue();await x.service.flushCook();assert.equal(x.calls.filter(c=>c.action==='task').length,1);assert.equal(model.stats(x.server.state).cooked,1);
});
test('快保存无慢状态，慢保存才显示低调同步提示',async()=>{
 const x=fixture();await x.ready();x.queue();await x.service.flushCook();assert.equal(x.service.cookStatus().slow,false);const gate=deferred();x.gates.push(gate);x.queue(x.meat[1].id);assert.equal(x.service.cookStatus().slow,false);await new Promise(resolve=>setTimeout(resolve,625));assert.equal(x.service.cookStatus().slow,true);assert.equal(x.page.data.cookSync.slow,true);gate.resolve();await x.service.flushCook();assert.equal(x.service.cookStatus().slow,false);
});
test('失败保留已做好预览与待保存记录，行内重试后保存',async()=>{
 const x=fixture();await x.ready();x.fail();x.queue();await assert.rejects(x.service.flushCook(),/连不上/);assert.deepEqual(x.cooked(),[x.meat[0].id]);assert.deepEqual(x.cooked(x.server.state),[]);assert.equal(x.page.data.busy,false);assert.equal(x.page.data.error,undefined);assert.equal(x.service.cookStatus().canRetry,true);assert.ok(x.store.get(x.service.COOK_KEY));await x.service.retryCook();assert.equal(x.store.get(x.service.COOK_KEY),null);assert.equal(x.service.cookStatus().pending,false);assert.deepEqual(x.cooked(x.server.state),[x.meat[0].id]);
});
test('切 tab 和云端轮询不覆盖尚未保存的做好',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue();await tick();const other={...x.page,data:{busy:false},route:'pages/v3-week/index'};await x.service.connect(other);await x.service.sync(true);assert.equal(other.data.plan.lines[0].tasks.cook,true);assert.equal(other.data.cookSync.pending,true);assert.equal(x.calls.filter(c=>c.action==='get').length,1);gate.resolve();await x.service.flushCook();assert.equal(other.data.cookSync.pending,false);
});
test('下周饭与周末饭的同一道菜各自保存，不串菜单',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue();await tick();x.queue(x.meat[0].id,'weekend');assert.equal(x.service.cookStatus().count,2);gate.resolve();await x.service.flushCook();assert.deepEqual(x.calls.filter(c=>c.action==='task').map(c=>c.data.type),['next','weekend']);assert.deepEqual(x.cooked(x.server.state,'next'),[x.meat[0].id]);assert.deepEqual(x.cooked(x.server.state,'weekend'),[x.meat[0].id]);assert.equal(model.stats(x.server.state).cooked,2);
});
test('普通任务和身份切换等待做好保存，使用实际版本',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue();await tick();const visible=model.getPlan(x.service.state(),'next',x.period),portion=x.service.call('task',{period:x.period,type:'next',id:x.meat[0].id,task:'portion',checked:true,version:visible.version});await tick();assert.equal(x.calls.filter(c=>c.action==='task').length,1);gate.resolve();await portion;const tasks=x.calls.filter(c=>c.action==='task');assert.equal(tasks[1].data.version,3);assert.equal(model.getPlan(x.server.state,'next',x.period).lines[0].tasks.portion,true);
 const gate2=deferred();x.gates.push(gate2);x.queue(x.meat[1].id);await tick();const switching=x.service.setRole('guest');await tick();assert.equal(x.calls.some(c=>c.action==='role'),false);gate2.resolve();await switching;assert.equal(x.service.role(),'guest');assert.equal(x.calls.at(-1).action,'role');
});
test('收藏等待期间可继续做好，所有待完成先保存再写收藏',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue();await tick();const favorite=x.service.call('favorite',{id:x.veg[0].id});x.queue(x.meat[1].id);gate.resolve();await favorite;assert.deepEqual(x.calls.filter(c=>c.action!=='get').map(c=>c.action),['task','task','favorite']);assert.deepEqual(x.server.state.favorites.cook,[x.veg[0].id]);
});
test('做好保存失败阻止普通写入与身份切换，不伪报成功',async()=>{
 const x=fixture();await x.ready();x.fail();x.queue();await assert.rejects(x.service.flushCook());await assert.rejects(x.service.call('favorite',{id:x.veg[0].id}));await assert.rejects(x.service.setRole('guest'));assert.equal(x.calls.some(c=>c.action==='role'||c.action==='favorite'),false);assert.equal(x.service.role(),'cook');
});
test('对方做好另一道菜和更新保存安排时安全重放，不覆盖远端字段',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue();await tick();x.server.state=model.apply(x.server.state,'cook','task',{period:x.period,type:'next',id:x.meat[1].id,task:'cook',checked:true,version:2});x.server.state=model.apply(x.server.state,'cook','storage',{period:x.period,type:'next',id:x.meat[0].id,storage:'冷冻',eatDate:x.period.week,reheat:'彻底加热',actualMultiplier:2,version:3});x.server.revision+=2;gate.resolve();await x.service.flushCook();assert.deepEqual(x.cooked(x.server.state),[x.meat[0].id,x.meat[1].id]);const first=model.getPlan(x.server.state,'next',x.period).lines[0];assert.equal(first.actualMultiplier,2);assert.equal(first.storage,'冷冻');assert.equal(first.reheat,'彻底加热');assert.equal(x.calls.filter(c=>c.action==='task').at(-1).data.version,4);
});
test('对方已做好同一道菜时直接确认，不重复写入',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue();await tick();x.server.state=model.apply(x.server.state,'cook','task',{period:x.period,type:'next',id:x.meat[0].id,task:'cook',checked:true,version:2});x.server.revision++;gate.resolve();await x.service.flushCook();assert.equal(x.calls.filter(c=>c.action==='task').length,1);assert.equal(x.server.revision,2);assert.equal(model.stats(x.server.state).cooked,1);
});
test('跨端仅重新点菜或修改草稿不改变原菜单，在途做好安全重放且保留对方草稿',async()=>{
 for(const intent of ['replacement','edit']){
  const x=fixture();await x.ready();const committed=clone(model.getPlan(x.server.state,'next',x.period).lines),gate=deferred();x.gates.push(gate);x.queue();await tick();
  const remote=(action,data={})=>{const version=model.getPlan(x.server.state,'next',x.period).version;x.server.state=model.apply(x.server.state,'guest',action,{period:x.period,type:'next',version,...data});x.server.revision++;};
  if(intent==='edit')remote('startEdit');
  const selection=x.lines(intent==='edit'?[...x.meat,...x.veg]:x.meat.slice(1));selection[0].note='还在挑菜，尚未提交';remote('selectDraft',{lines:selection});
  const drafted=clone(model.getPlan(x.server.state,'next',x.period)),expectedVersion=drafted.version;assert.equal(drafted.draftIntent,intent);assert.deepEqual(drafted.lines,committed);assert.equal(drafted.status,'confirmed');
  gate.resolve();await x.service.flushCook();assert.deepEqual(x.cooked(x.server.state),[x.meat[0].id]);assert.equal(x.service.cookStatus().phase,'idle');assert.equal(x.service.cookStatus().pending,false);
  const saved=model.getPlan(x.server.state,'next',x.period);assert.deepEqual(saved.draftLines,drafted.draftLines);assert.equal(saved.draftIntent,intent);assert.equal(saved.lines[0].note,committed[0].note);
  const writes=x.calls.filter(c=>c.action==='task');assert.equal(writes.length,2);assert.equal(writes.at(-1).data.version,expectedVersion);assert.equal(writes.at(-1).data.expectedRevision,intent==='edit'?3:2);
 }
});
test('跨端真正替换并重新确认原菜单后，在途旧做好记录仍冲突而不标记新餐单',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue();await tick();
 const remote=(role,action,data={})=>{const version=model.getPlan(x.server.state,'next',x.period).version;x.server.state=model.apply(x.server.state,role,action,{period:x.period,type:'next',version,...data});x.server.revision++;};
 const replacement=x.lines([...x.meat,...x.veg]);replacement[0].note='已经提交替换的菜单';remote('guest','selectDraft',{lines:replacement});remote('guest','submitMenu',{replaceConfirmed:true});remote('cook','confirm');
 const replaced=clone(model.getPlan(x.server.state,'next',x.period));assert.equal(replaced.status,'confirmed');assert.equal(replaced.lines[0].note,replacement[0].note);
 gate.resolve();await assert.rejects(x.service.flushCook(),/菜单已调整/);assert.equal(x.service.cookStatus().phase,'conflict');assert.equal(x.service.cookStatus().canRetry,false);assert.deepEqual(x.cooked(x.server.state),[]);assert.deepEqual(model.getPlan(x.server.state,'next',x.period),replaced);
 assert.equal(x.calls.filter(c=>c.action==='task').length,1);await x.service.discardCookQueue();assert.equal(x.service.cookStatus().phase,'idle');assert.deepEqual(model.getPlan(x.server.state,'next',x.period),replaced);
});
test('菜单改菜、菜被移除、确认状态变化均停止队列，不给新菜单标记做好',async()=>{
 for(const change of ['lines','removed','status','confirmation']){
  const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue();await tick();const key=model.planKey('next',x.period),plan=x.server.state.plans[key];if(change==='lines')plan.lines[0].multiplier=2;if(change==='removed')plan.lines.shift();if(change==='status')plan.status='submitted';if(change==='confirmation')plan.confirmedAt=300;plan.version++;x.server.revision++;gate.resolve();await assert.rejects(x.service.flushCook(),/菜单已调整/);assert.equal(x.service.cookStatus().phase,'conflict');assert.equal(x.service.cookStatus().canRetry,false);assert.equal(x.service.cookStatus().count,1);assert.deepEqual(x.cooked(x.server.state),[]);await assert.rejects(x.service.retryCook(),/菜单已调整/);await x.service.discardCookQueue();assert.equal(x.service.cookStatus().phase,'idle');assert.deepEqual(x.cooked(),[]);
 }
});
test('服务端已保存但响应丢失，重试幂等识别，临时图片地址变化不制造冲突',async()=>{
 const x=fixture();const key=model.planKey('next',x.period);x.server.state.plans[key].recipes[0].displayImage='https://old.test/img';await x.ready();x.lose();x.queue();await assert.rejects(x.service.flushCook());assert.equal(x.server.revision,2);x.server.state.plans[key].recipes[0].displayImage='https://new.test/img';await x.service.retryCook();assert.equal(x.calls.filter(c=>c.action==='task').length,1);assert.equal(x.server.revision,2);assert.equal(model.stats(x.server.state).cooked,1);
});
test('待保存做好跨重启恢复；丢失响应但已保存的也能恢复而不重复计数',async()=>{
 for(const lost of [false,true]){
  const x=fixture();await x.ready();if(lost)x.lose();else x.fail();x.queue();await assert.rejects(x.service.flushCook());const y=fixture(x.store);y.server.state=clone(x.server.state);y.server.revision=x.server.revision;await y.ready();await y.service.flushCook();assert.equal(y.service.cookStatus().pending,false);assert.equal(model.stats(y.server.state).cooked,1);assert.equal(y.calls.filter(c=>c.action==='task').length,lost?0:1);
 }
});
test('旧版持久做好签名含点餐草稿，升级后只规范化草稿字段并恢复未变的原菜单',async()=>{
 const x=fixture(),remote=(action,data={})=>{const version=model.getPlan(x.server.state,'next',x.period).version;x.server.state=model.apply(x.server.state,'guest',action,{period:x.period,type:'next',version,...data});x.server.revision++;};
 remote('startEdit');remote('selectDraft',{lines:x.lines([...x.meat,...x.veg]).map((l,i)=>i?l:{...l,note:'旧版未提交草稿'})});await x.ready();x.fail();x.queue();await assert.rejects(x.service.flushCook());
 const saved=clone(x.store.get(x.service.COOK_KEY)),oldPlan=model.getPlan(x.server.state,'next',x.period),signature=JSON.parse(saved.entries[0].signature);
 signature.draftLines=clone(oldPlan.draftLines);signature.draftIntent=oldPlan.draftIntent;saved.entries[0].signature=JSON.stringify(signature);x.store.set(x.service.COOK_KEY,saved);
 remote('discardDraft');remote('selectDraft',{lines:x.lines(x.meat.slice(1))});const latest=clone(model.getPlan(x.server.state,'next',x.period)),y=fixture(x.store);y.server.state=clone(x.server.state);y.server.revision=x.server.revision;
 await y.ready();await y.service.flushCook();assert.equal(y.service.cookStatus().phase,'idle');assert.deepEqual(y.cooked(y.server.state),[y.meat[0].id]);assert.equal(y.calls.filter(c=>c.action==='task').length,1);
 const final=model.getPlan(y.server.state,'next',y.period);assert.equal(final.confirmedAt,latest.confirmedAt);assert.deepEqual(final.draftLines,latest.draftLines);assert.equal(final.draftIntent,'replacement');assert.equal(final.lines[0].note,latest.lines[0].note);assert.equal(y.store.get(y.service.COOK_KEY),null);
});
test('旧版含草稿的持久做好签名不能给真正替换并确认的新餐单标记做好',async()=>{
 const x=fixture();await x.ready();x.fail();x.queue();await assert.rejects(x.service.flushCook());const saved=clone(x.store.get(x.service.COOK_KEY)),signature=JSON.parse(saved.entries[0].signature);
 signature.draftLines=x.lines(x.meat.slice(1));signature.draftIntent='replacement';saved.entries[0].signature=JSON.stringify(signature);x.store.set(x.service.COOK_KEY,saved);
 const remote=(role,action,data={})=>{const version=model.getPlan(x.server.state,'next',x.period).version;x.server.state=model.apply(x.server.state,role,action,{period:x.period,type:'next',version,...data});x.server.revision++;};
 const replacement=x.lines([...x.meat,...x.veg]);replacement[0].note='已换成另一份安排';remote('guest','selectDraft',{lines:replacement});remote('guest','submitMenu',{replaceConfirmed:true});remote('cook','confirm');
 const changed=clone(model.getPlan(x.server.state,'next',x.period)),y=fixture(x.store);y.server.state=clone(x.server.state);y.server.revision=x.server.revision;
 await y.ready();await assert.rejects(y.service.flushCook(),/菜单已调整/);assert.equal(y.service.cookStatus().phase,'conflict');assert.equal(y.service.cookStatus().canRetry,false);assert.equal(y.calls.some(c=>c.action==='task'),false);assert.deepEqual(y.cooked(y.server.state),[]);assert.deepEqual(model.getPlan(y.server.state,'next',y.period),changed);
 const retained=y.store.get(y.service.COOK_KEY);assert.ok(retained);const normalized=JSON.parse(retained.entries[0].signature);assert.equal(normalized.draftLines,undefined);assert.equal(normalized.draftIntent,undefined);assert.deepEqual(normalized.lines,signature.lines);assert.equal(normalized.confirmedAt,signature.confirmedAt);
});
test('无法解析或结构不合法的持久做好签名保留为冲突，不能恢复制作写入',async()=>{
 for(const signature of ['not-json','{broken','null','[]','{"key":"next:bad"}','{"lines":"invalid"}']){
  const x=fixture();await x.ready();x.fail();x.queue();await assert.rejects(x.service.flushCook());const saved=clone(x.store.get(x.service.COOK_KEY));saved.entries[0].signature=signature;x.store.set(x.service.COOK_KEY,saved);
  const y=fixture(x.store);y.server.state=clone(x.server.state);y.server.revision=x.server.revision;await y.ready();await assert.rejects(y.service.flushCook(),/菜单已调整/);
  assert.equal(y.service.cookStatus().phase,'conflict');assert.equal(y.service.cookStatus().canRetry,false);assert.equal(y.calls.some(c=>c.action==='task'),false);assert.deepEqual(y.cooked(y.server.state),[]);assert.equal(y.store.get(y.service.COOK_KEY).entries[0].signature,signature);
 }
});
test('重启为点餐者时隐藏本机未保存做好，切回大厨后再同步',async()=>{
 const x=fixture();await x.ready();x.fail();x.queue();await assert.rejects(x.service.flushCook());const y=fixture(x.store,{role:'guest'});await y.ready();assert.deepEqual(y.cooked(),[]);assert.equal(model.stats(y.service.state()).cooked,0);assert.equal(y.service.cookStatus().canRetry,false);await assert.rejects(y.service.retryCook(),/大厨身份/);assert.equal(y.calls.some(c=>c.action==='task'),false);await y.service.setRole('cook');assert.deepEqual(y.cooked(y.server.state),[y.meat[0].id]);assert.equal(y.service.cookStatus().phase,'idle');
});
test('饭桌变更不会恢复另一饭桌的待保存做好',async()=>{
 const x=fixture();await x.ready();x.fail();x.queue();await assert.rejects(x.service.flushCook());const y=fixture(x.store,{familyId:'table-b'});await y.ready();assert.deepEqual(y.cooked(),[]);assert.equal(y.service.cookStatus().pending,false);assert.equal(y.calls.some(c=>c.action==='task'),false);
});
test('未确认菜单、点餐者、缺失菜品在点击时拒绝，不写入队列',async()=>{
 for(const invalid of ['role','status','id']){const x=fixture();if(invalid==='role')x.server.role='guest';if(invalid==='status')x.server.state.plans[model.planKey('next',x.period)].status='submitted';await x.ready();assert.throws(()=>x.queue(invalid==='id'?'absent':x.meat[0].id),/大厨|确认|不存在/);assert.equal(x.service.cookStatus().pending,false);assert.equal(x.calls.some(c=>c.action==='task'),false);}
});
test('正在刷新的最新菜单先结束，若已改菜单就停旧做好意图',async()=>{
 const x=fixture();await x.ready();const readGate=deferred(),original=wx.cloud.callFunction;let gateNextGet=true;wx.cloud.callFunction=async args=>{if(gateNextGet&&args.data.action==='get'){gateNextGet=false;await readGate.promise;}return original(args);};const refresh=x.service.sync(true);await tick();x.queue();await tick();const key=model.planKey('next',x.period);x.server.state.plans[key].status='submitted';x.server.state.plans[key].version++;x.server.revision++;readGate.resolve();await refresh;await assert.rejects(x.service.flushCook(),/菜单已调整/);assert.equal(x.calls.some(c=>c.action==='task'),false);await x.service.discardCookQueue();
});
test('本机模式做好仍即时同步，无云端队列且正向重复点幂等',()=>{
 const store=new Map();global.wx={getStorageSync:key=>store.get(key),setStorageSync:(key,value)=>store.set(key,clone(value))};const modulePath=require.resolve('../miniprogram/utils/planning-service');delete require.cache[modulePath];const s=require(modulePath);const period=model.period();s.setRole('guest');const items=s.state().recipes.filter(r=>!r.hidden);const lines=['meat','veg'].flatMap(kind=>items.filter(r=>r.kind===kind).slice(0,3)).map(r=>({id:r.id,multiplier:1,spice:'不辣'}));s.call('submit',{period,type:'next',version:0,lines});s.setRole('cook');s.call('confirm',{period,type:'next',version:1});const result=s.queueCook(null,{period,type:'next',id:lines[0].id});assert.equal(result.then,undefined);assert.equal(model.getPlan(result,'next',period).lines[0].tasks.cook,true);s.queueCook(null,{period,type:'next',id:lines[0].id});assert.equal(model.getPlan(s.state(),'next',period).version,3);assert.equal(s.flushCook().then,undefined);assert.equal(s.cookStatus().pending,false);
});
test('完成全部菜时即时显示制作完毕，服务器最终状态和统计一致',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue();await tick();for(const r of [...x.meat.slice(1),...x.veg])x.queue(r.id);assert.equal(model.getPlan(x.service.state(),'next',x.period).status,'cooked');assert.equal(model.stats(x.service.state()).cooked,6);assert.equal(x.page.data.busy,false);gate.resolve();await x.service.flushCook();assert.equal(model.getPlan(x.server.state,'next',x.period).status,'cooked');assert.equal(model.stats(x.server.state).cooked,6);assert.equal(x.service.cookStatus().pending,false);
});
test('丢失响应后对方新增点评，重试不重复制作也不覆盖点评',async()=>{
 const x=fixture();await x.ready();x.lose();x.queue();await assert.rejects(x.service.flushCook());x.server.state=model.apply(x.server.state,'guest','record',{period:x.period,type:'next',id:x.meat[0].id,result:'吃完了',again:true,version:3});x.server.revision++;await x.service.retryCook();assert.equal(x.calls.filter(c=>c.action==='task').length,1);assert.equal(model.stats(x.server.state).cooked,1);assert.equal(model.stats(x.server.state).again,1);assert.equal(x.service.state().records.length,1);
});
test('保存安排等待做好队列完成后用真实版本写入',async()=>{
 const x=fixture();await x.ready();const gate=deferred();x.gates.push(gate);x.queue();await tick();const visible=model.getPlan(x.service.state(),'next',x.period),saving=x.service.call('storage',{period:x.period,type:'next',id:x.meat[0].id,storage:'冷冻',eatDate:x.period.week,reheat:'彻底加热',actualMultiplier:2,version:visible.version});await tick();assert.equal(x.calls.some(c=>c.action==='storage'),false);gate.resolve();await saving;assert.equal(x.calls.find(c=>c.action==='storage').data.version,3);const line=model.getPlan(x.server.state,'next',x.period).lines[0];assert.equal(line.tasks.cook,true);assert.equal(line.actualMultiplier,2);assert.equal(line.storage,'冷冻');
});
