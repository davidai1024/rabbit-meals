const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createHandler}=require('../cloudfunctions/planningFamily/handler'),model=require('../miniprogram/utils/planning'),catalog=require('../miniprogram/utils/catalog-migration');
const {command,applyUpdate}=require('./helpers/cloud-update');
const copy=x=>JSON.parse(JSON.stringify(x));
function server(){
 const store={},metrics={reads:0,urls:0,collections:0};let uid='a';
 const collection=n=>({doc:id=>({get:async()=>{metrics.reads++;if(!store[n]?.[id])throw Error('not exist');return {data:copy(store[n][id])};},set:async({data})=>{store[n][id]=copy(data);},update:async({data})=>applyUpdate(store[n][id],data)}),where:q=>({limit:()=>({get:async()=>({data:Object.entries(store[n]).filter(([,v])=>v.code===q.code).map(([k,v])=>({...v,_id:k}))})})})});
 let lock=Promise.resolve();const db={command,collection,createCollection:async n=>{metrics.collections++;if(store[n])throw Error('already exist');store[n]={};},runTransaction:fn=>{const p=lock.then(()=>fn({collection}));lock=p.catch(()=>{});return p;}};
 return {store,metrics,as:v=>uid=v,handler:createHandler({database:()=>db,getWXContext:()=>({OPENID:uid}),getTempFileURL:async({fileList})=>{metrics.urls++;return {fileList:fileList.map(fileID=>({fileID,tempFileURL:'https://example.test/image',status:0}))};}})};
}
function client(){
 const requests=[],stored=new Map(),writes=[];
 const wx={cloud:{callFunction:o=>new Promise((resolve,reject)=>requests.push({request:o,resolve:r=>resolve({result:copy(r)}),reject}))},getStorageSync:k=>stored.get(k),setStorageSync:(k,v)=>{writes.push(k);stored.set(k,copy(v));},switchTab:()=>{},navigateTo:()=>{}};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/utils/planning-service.js'),'utf8'),{module,wx,require:name=>name==='./config'?{env:'test-env'}:name==='./service'?{isDemo:()=>false,display:r=>r.image}:require(path.join(__dirname,'../miniprogram/utils',name)),Date,setInterval,clearInterval,setTimeout,clearTimeout});
 const service=module.exports,page={route:'pages/v3-menu/index',data:{busy:false,error:''},loads:0,setData(v){Object.assign(this.data,v);},load(){this.loads++;this.rendered=copy(service.state());}};
 const state=catalog.migrate(model.initial()),initial={ok:true,role:'guest',familyId:'f',revision:1,code:'c',members:1,state};
 return {service,page,requests,stored,writes,initial};
}
async function ready(c){const request=c.service.sync();await tick();c.requests[0].resolve(c.initial);await request;}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('选菜精简回复只传本次计划，旧客户端保留完整状态，版本冲突仍拒绝',async()=>{
 const x=server();assert.equal((await x.handler({action:'get'})).unbound,true);assert.equal(x.metrics.collections,0);let created=await x.handler({action:'create',data:{role:'guest'}}),p=model.period();const recipe=created.state.recipes.find(r=>r.kind==='meat');const before=x.metrics.reads;
 const response=await x.handler({action:'selectDraft',data:{period:p,type:'next',version:0,lines:[{id:recipe.id,multiplier:1,spice:'不辣'}],expectedRevision:created.revision,compact:true}});
 assert.equal(response.ok,true);assert.equal(response.state,undefined);assert.equal(response.baseRevision,1);assert.equal(response.patch.plans[model.planKey('next',p)].draftLines[0].id,recipe.id);assert.ok(JSON.stringify(response).length<JSON.stringify(created).length/3);assert.equal(x.metrics.reads-before,3);
 const stale=await x.handler({action:'favorite',data:{id:recipe.id,expectedRevision:1,compact:true}});assert.equal(stale.ok,false);assert.match(stale.error,/另一位/);
 const legacy=await x.handler({action:'favorite',data:{id:recipe.id,expectedRevision:response.revision}});assert.ok(legacy.state.recipes.length);assert.equal(legacy.patch,undefined);
});
test('上传图片地址在温热云函数中复用，精简收藏回复不解析图片',async()=>{
 const x=server(),r=await x.handler({action:'create',data:{role:'guest'}});x.store.mealFamilies[r.familyId].state.recipes[0].image='cloud://env/meals/photo.png';
 const one=await x.handler({action:'get'}),two=await x.handler({action:'get'});assert.equal(one.state.recipes[0].displayImage,'https://example.test/image');assert.equal(two.state.recipes[0].displayImage,one.state.recipes[0].displayImage);assert.equal(x.metrics.urls,1);
 await x.handler({action:'favorite',data:{id:r.state.recipes[0].id,expectedRevision:r.revision,compact:true}});assert.equal(x.metrics.urls,1);
});
test('选菜立即预览且不阻塞其他操作，只有云端确认后才持久化；精简回复保留其他状态',async()=>{
 const c=client();await ready(c);const p=model.period(),id=c.initial.state.recipes.find(r=>r.kind==='meat').id;
 c.service.queueDraft(c.page,{period:p,type:'next',version:0,lines:[{id,multiplier:1,spice:'不辣'}]});c.page.load();const operation=c.service.flushDraft();
 assert.equal(c.page.rendered.plans[model.planKey('next',p)].draftLines[0].id,id);assert.equal(c.service.draftStatus().pending,true);assert.equal(c.stored.get('rabbit-meals-cloud-cache').revision,1);assert.equal(c.page.data.busy,false);await tick();
 const state=model.apply(c.initial.state,'guest','selectDraft',c.requests[1].request.data.data);c.requests[1].resolve({...c.initial,state:undefined,revision:2,baseRevision:1,patch:{plans:{[model.planKey('next',p)]:state.plans[model.planKey('next',p)]}}});await operation;
 assert.equal(c.service.draftStatus().pending,false);assert.equal(c.page.data.busy,false);assert.equal(c.service.info().revision,2);assert.equal(c.service.state().recipes.length,c.initial.state.recipes.length);assert.equal(c.stored.get('rabbit-meals-cloud-cache').revision,2);
});
test('云端冲突马上回滚预览并给出错误，刷新后展示对方状态，不写本机菜单',async()=>{
 const c=client();await ready(c);const p=model.period(),id=c.initial.state.recipes[0].id;let completed=false;
 const operation=c.service.run(c.page,()=>c.service.after(c.service.call('favorite',{id}),()=>{completed=true;}));assert.ok(c.page.rendered.favorites.guest.includes(id));await tick();
 c.requests[1].resolve({ok:false,error:'另一位已更新菜单，请刷新后再操作'});await tick();assert.equal(c.page.rendered.favorites.guest.includes(id),false);assert.match(c.page.data.error,/另一位/);assert.equal(completed,false);
 c.requests[2].resolve({...c.initial,revision:2});await operation;assert.equal(c.service.info().revision,2);assert.equal(c.page.data.busy,false);assert.equal(c.stored.has(c.service.KEY),false);
});
test('频繁切换页面不显示阻塞加载、不重复请求；无变化刷新不重复写整库缓存',async()=>{
 const c=client();await ready(c);await c.service.connect(c.page);await c.service.connect(c.page);assert.equal(c.requests.length,1);assert.equal(c.page.data.busy,false);assert.equal(c.page.loads,1);
 const count=c.writes.length,refresh=c.service.sync(true);await tick();c.requests[1].resolve({...c.initial,state:undefined,unchanged:true});await refresh;assert.equal(c.writes.length,count);
});
test('断网失败立即回滚，保留未确认提示且不会伪报保存成功',async()=>{
 const c=client();await ready(c);const id=c.initial.state.recipes[0].id;let completed=false;
 const operation=c.service.run(c.page,()=>c.service.after(c.service.call('favorite',{id}),()=>{completed=true;}));await tick();c.requests[1].reject(Error('network unavailable'));await tick();assert.equal(c.page.rendered.favorites.guest.includes(id),false);assert.match(c.page.data.error,/暂时连不上/);c.requests[2].reject(Error('network unavailable'));await operation;assert.equal(completed,false);assert.equal(c.service.info().revision,1);assert.equal(c.page.data.busy,false);
});
