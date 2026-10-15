const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const model=require('../miniprogram/utils/planning'),catalog=require('../miniprogram/utils/catalog-migration');
const copy=x=>JSON.parse(JSON.stringify(x)),tick=()=>new Promise(resolve=>setImmediate(resolve));
function client(){
 const stored=new Map(),requests=[],navigation=[],intervals=new Set();let activePage,now=Date.now();
 const wx={getStorageSync:k=>stored.get(k),setStorageSync:(k,v)=>stored.set(k,copy(v)),cloud:{callFunction:o=>new Promise((resolve,reject)=>requests.push({request:o,resolve:r=>resolve({result:copy(r)}),reject}))},switchTab:o=>navigation.push(o),navigateTo:o=>navigation.push(o),hideToast(){},showToast(){}};
 const Clock=class extends Date{static now(){return now;}};
 const context={wx,getCurrentPages:()=>activePage?[activePage]:[],Date:Clock,setInterval:(callback,delay)=>{const timer={callback,delay,unref(){}};intervals.add(timer);return timer;},clearInterval:timer=>intervals.delete(timer),setTimeout,clearTimeout};
 const dir=path.join(__dirname,'../miniprogram/utils');
 const serviceModule={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(dir,'planning-service.js'),'utf8'),{...context,module:serviceModule,require:name=>name==='./config'?{env:'test-env'}:name==='./service'?{isDemo:()=>false,display:r=>r.image||r.localImage}:require(path.join(dir,name))});
 const service=serviceModule.exports,isolated=new Map([['./planning-service',service]]),runtime=new Set(['./menu-actions','./swipe-menu','./ordering-pages','./history-page','./planning-pages','./tips']);
 function load(name){
  if(isolated.has(name))return isolated.get(name);
  if(!runtime.has(name))return require(path.join(dir,name));
  const module={exports:{}};isolated.set(name,module.exports);
  vm.runInNewContext(fs.readFileSync(path.join(dir,name+'.js'),'utf8'),{...context,module,require:load});isolated.set(name,module.exports);return module.exports;
 }
 const pages=load('./planning-pages');
 const initial={ok:true,role:'guest',familyId:'f',revision:1,code:'c',members:1,state:catalog.migrate(model.initial())};
 function page(name){const def=pages[name](),updates=[],frames=[],p={...def,route:'pages/v3-'+name+'/index',data:copy(def.data),updates,frames,setData(v){updates.push(v);Object.assign(this.data,v);frames.push(copy(this.data));},getTabBar(){return {sync(){}}}};return p;}
 return {service,initial,requests,navigation,stored,page,show:p=>activePage=p,poll(){now+=5000;for(const timer of intervals)if(timer.delay===5000)timer.callback();}};
}
async function ready(c){const request=c.service.sync();await tick();c.requests[0].resolve(c.initial);await request;}
async function show(c,p){c.show(p);p.onShow();await tick();}
const fullUpdates=p=>p.updates.filter(v=>'plan' in v||'filtered' in v||'carouselCards' in v||'summaries' in v);
test('已有云缓存的新点菜页在 onLoad 填充首帧，返回相同 tab 不重绘菜库和轮播',async()=>{
 const c=client();await ready(c);const p=c.page('menu');c.show(p);p.onLoad({});
 assert.ok(p.data.filtered.length>0);assert.ok(p.data.carouselCards.length>0);assert.equal(p.data.role,'guest');assert.ok(fullUpdates(p).length>0);
 p.updates.length=0;await show(c,p);assert.equal(fullUpdates(p).length,0);
 p.onHide();p.updates.length=0;await show(c,p);assert.equal(fullUpdates(p).length,0);assert.equal(c.requests.length,1);assert.equal(p.data.busy,false);p.onHide();
});
test('离开再返回菜单 tab 保留做饭清单和菜单详情，不重建概览插图',async()=>{
 const c=client();await ready(c);const p=c.page('week');c.show(p);p.onLoad({});await show(c,p);
 p.workspace();assert.equal(p.data.view,'work');p.onHide();p.updates.length=0;await show(c,p);assert.equal(p.data.view,'work');assert.equal(fullUpdates(p).length,0);
 p.openPlan({currentTarget:{dataset:{type:'next'}}});assert.equal(p.data.view,'menu');p.onHide();p.updates.length=0;await show(c,p);assert.equal(p.data.view,'menu');assert.equal(fullUpdates(p).length,0);p.onHide();
});
test('返回页面仍刷新远端变化、身份、餐单类型和跨周状态',async()=>{
 const c=client();await ready(c);const p=c.page('week');c.show(p);p.onLoad({});await c.service.connect(p);
 p.updates.length=0;c.service.select('weekend',0);await c.service.connect(p);assert.equal(p.data.type,'weekend');assert.equal(fullUpdates(p).filter(v=>'plan' in v).length,1);
 const remote=copy(c.initial.state);remote.requests.push({id:'new-request',name:'她想吃的新菜',status:'待补录'});
 const refresh=c.service.sync(true);await tick();c.requests[1].resolve({...c.initial,revision:2,state:remote});await refresh;
 p.updates.length=0;await c.service.connect(p);assert.equal(p.data.requests[0].name,'她想吃的新菜');assert.equal(fullUpdates(p).filter(v=>'plan' in v).length,1);
 const roleRefresh=c.service.sync(true);await tick();c.requests[2].resolve({...c.initial,revision:2,state:undefined,unchanged:true,role:'cook'});await roleRefresh;
 p.updates.length=0;await c.service.connect(p);assert.equal(p.data.role,'cook');assert.equal(fullUpdates(p).filter(v=>'plan' in v).length,1);
 p.data.period={...p.data.period,key:'previous-week'};p.updates.length=0;await c.service.connect(p);assert.equal(p.data.period.key,model.period().key);assert.equal(fullUpdates(p).filter(v=>'plan' in v).length,1);
 p.updates.length=0;await c.service.connect(p);assert.equal(fullUpdates(p).length,0);
});
test('首次连接响应迟到时不重绘隐藏页，也不把当前导航拉回旧 tab',async()=>{
 const c=client(),p=c.page('menu');c.show(p);p.onLoad({});const connection=c.service.connect(p);await tick();c.show(c.page('stats'));
 c.requests[0].resolve({...c.initial,role:'cook'});await connection;
 assert.equal(fullUpdates(p).length,0);assert.equal(c.navigation.length,0);assert.equal(c.service.role(),'cook');assert.equal(p.data.busy,false);
});
test('模拟 load 调用者保留窄范围标记，相同缓存只首次加载一次',async()=>{
 const c=client();await ready(c);const p={route:'pages/v3-week/index',data:{busy:false},loads:0,setData(v){Object.assign(this.data,v);},load(){this.loads++;}};c.show(p);
 await c.service.connect(p);await c.service.connect(p);assert.equal(p.loads,1);
 c.service.select('weekend',0);await c.service.connect(p);assert.equal(p.loads,2);
});
test('冷启动在真实云状态准备前不显示占位业务，数据与身份齐备后才ready',async()=>{
 const c=client(),p=c.page('menu');c.show(p);p.onLoad({});assert.equal(p.data.pageReady,false);assert.equal(p.data.pageLoading,true);assert.equal(c.service.contentReady(),false);
 p.load();assert.equal(p.data.pageReady,false);assert.equal(p.data.filtered.length,0);const loading=p.onShow();await tick();assert.equal(c.requests.length,1);assert.equal(p.data.busy,false);assert.equal(fullUpdates(p).length,0);
 c.requests[0].resolve(c.initial);await loading;assert.equal(p.data.pageReady,true);assert.equal(p.data.pageLoading,false);assert.equal(p.data.pageLoadError,'');
 const first=p.frames.find(frame=>frame.pageReady);assert.ok(first.filtered.length>0);assert.ok(first.carouselCards.length>0);assert.equal(first.role,'guest');assert.equal(first.cardReady,true);p.onHide();
});
test('冷启动失败留在简短错误过渡，重试不依赖busy且成功清错误，不叠加tip',async()=>{
 const c=client(),p=c.page('menu');c.show(p);p.onLoad({});const first=p.onShow();await tick();c.requests[0].reject(Error('internal env-id secret details'));await first;
 assert.equal(p.data.pageReady,false);assert.equal(p.data.pageLoading,false);assert.equal(p.data.pageLoadError,'暂时连接不上，请检查网络后再试。');assert.equal(p.data.error,'');assert.equal(p.data.tip,null);assert.equal(fullUpdates(p).length,0);
 p.data.busy=true;const retry=p.retryPageLoad();await tick();assert.equal(c.requests.length,2);assert.equal(p.data.pageLoading,true);assert.equal(p.data.pageLoadError,'');assert.equal(p.data.pageReady,false);
 c.requests[1].resolve(c.initial);await retry;assert.equal(p.data.pageReady,true);assert.equal(p.data.pageLoading,false);assert.equal(p.data.pageLoadError,'');assert.equal(p.data.tip,null);p.data.busy=false;p.onHide();
});
test('云端未确认前不信任本机旧身份，返回真实身份后才导航，权限错误页不曝光',async()=>{
 const c=client();c.stored.set('rabbit-meals-role','cook');const p=c.page('menu');c.show(p);p.onLoad({});const loading=p.onShow();await tick();assert.equal(c.navigation.length,0);assert.equal(p.data.pageReady,false);
 c.requests[0].resolve({...c.initial,role:'cook'});await loading;assert.equal(c.navigation.at(-1).url,'/pages/v3-week/index');assert.equal(p.data.pageReady,false);assert.equal(fullUpdates(p).length,0);
 const correct=c.page('week');c.show(correct);correct.onLoad({});assert.equal(correct.data.pageReady,true);assert.equal(correct.data.role,'cook');assert.equal(correct.data.pageLoading,false);p.onHide();
});
test('冷启动无完整云状态不把demo菜库当作准备成功，未绑定只进入真实绑定页',async()=>{
 for(const response of [{ok:true,role:'guest',unchanged:true,revision:1},{ok:true,unbound:true}]){
  const c=client(),p=c.page('menu');c.show(p);p.onLoad({});const loading=p.onShow();await tick();c.requests[0].resolve(response);await loading;
  assert.equal(p.data.pageReady,false);assert.equal(fullUpdates(p).length,0);assert.equal(p.data.tip,null);
  if(response.unbound)assert.equal(c.navigation.at(-1).url,'/pages/pair/index');else{assert.equal(p.data.pageLoading,false);assert.ok(p.data.pageLoadError);}
  p.onHide();
 }
});
test('已有可信缓存切tab立即准备，后台慢刷新或失败都不重置ready与业务内容',async()=>{
 const c=client();await ready(c);const p=c.page('menu');c.show(p);p.onLoad({});assert.equal(p.data.pageReady,true);p.frames.length=0;p.updates.length=0;
 const refreshing=c.service.connect(p,true);await tick();assert.equal(c.requests.length,2);assert.equal(p.data.pageReady,true);assert.equal(p.data.pageLoading,false);assert.equal(fullUpdates(p).length,0);
 c.requests[1].reject(Error('network'));await refreshing;assert.equal(p.data.pageReady,true);assert.equal(p.data.pageLoadError,'');assert.equal(p.data.tip,null);assert.ok(p.frames.every(f=>f.pageReady));
});
test('历史通知详情冷启动保留目标，菜品编辑warm首帧准备，图片下载不阻断ready',async()=>{
 const c=client(),period=model.period(),key=model.planKey('next',period),recipe=c.initial.state.recipes.find(r=>!r.hidden);recipe.image='https://images.invalid/not-loaded.jpg';
 c.initial.state.plans[key]={...model.getPlan(c.initial.state,'next',period),status:'submitted',lines:[{id:recipe.id,multiplier:1}],recipes:[copy(recipe)]};
 const history=c.page('history');c.show(history);history.onLoad({key,source:'ordered'});assert.equal(history.data.pageReady,false);assert.equal(history.data.selectedKey,key);const loading=history.onShow();await tick();c.requests[0].resolve({...c.initial,role:'cook'});await loading;
 assert.equal(history.data.pageReady,true);assert.equal(history.data.selected.key,key);assert.equal(history.data.selected.lines[0].image,recipe.image);
 const editor=c.page('recipe');c.show(editor);editor.onLoad({id:recipe.id});assert.equal(editor.data.pageReady,true);assert.equal(editor.data.r.id,recipe.id);assert.equal(editor.data.photo,recipe.image);history.onHide();
});
test('七个业务页面均须真实首load完成才ready，初次空状态不提前曝光',async()=>{
 for(const name of ['menu','week','shopping','stats','home','history','recipe']){
  const c=client(),p=c.page(name);c.show(p);p.onLoad(name==='recipe'?{id:c.initial.state.recipes[0].id}:{});assert.equal(p.data.pageReady,false,name);const loading=p.onShow();await tick();assert.equal(p.data.pageReady,false,name);assert.equal(fullUpdates(p).length,0,name);
  c.requests[0].resolve({...c.initial,role:name==='menu'?'guest':'cook'});await loading;assert.equal(p.data.pageReady,true,name);assert.equal(p.data.pageLoading,false,name);assert.equal(p.data.pageLoadError,'',name);assert.equal(p.data.tip,null,name);if(name==='recipe')assert.ok(p.data.r);p.onHide();
 }
});
test('后台同revision变更身份会刷新允许页面的真实角色，不保留旧权限按钮',async()=>{
 const c=client();await ready(c);const p=c.page('week');c.show(p);p.onLoad({});p.onShow();await tick();assert.equal(p.data.role,'guest');p.updates.length=0;
 c.poll();await tick();assert.equal(c.requests.length,2);c.requests[1].resolve({...c.initial,role:'cook',state:undefined,unchanged:true});await tick();
 assert.equal(p.data.role,'cook');assert.equal(p.data.pageReady,true);assert.equal(p.data.pageLoading,false);assert.equal(fullUpdates(p).filter(v=>'plan' in v).length,1);assert.equal(c.navigation.length,0);
 p.updates.length=0;c.poll();await tick();c.requests[2].resolve({...c.initial,role:'cook',state:undefined,unchanged:true});await tick();assert.equal(fullUpdates(p).length,0);p.onHide();
});
test('后台身份变为点餐时大厨专属页面先隐藏旧权限并切正确tab，不陷入永久过渡',async()=>{
 for(const name of ['home','shopping','recipe']){
  const c=client();c.initial.role='cook';await ready(c);const p=c.page(name);c.show(p);p.onLoad(name==='recipe'?{id:c.initial.state.recipes[0].id}:{});p.onShow();await tick();assert.equal(p.data.pageReady,true,name);c.poll();await tick();
  const remote=copy(c.initial.state);remote.requests.push({id:'fresh',status:'待补录',name:'新需求'});c.requests[1].resolve({...c.initial,role:'guest',revision:2,state:remote});await tick();
  assert.equal(c.navigation.at(-1).url,'/pages/v3-menu/index',name);assert.equal(p.data.pageReady,false,name);assert.equal(p.data.pageLoadError,'',name);
  const allowed=c.page('menu');c.show(allowed);allowed.onLoad({});assert.equal(allowed.data.pageReady,true,name);assert.equal(allowed.data.role,'guest',name);assert.equal(allowed.data.requests[0].id,'fresh',name);p.onHide();
 }
});
test('后台解绑响应安全进入绑定页并隐藏原业务，迟到回复不把别的页面拉走',async()=>{
 const c=client();await ready(c);const p=c.page('menu');c.show(p);p.onLoad({});p.onShow();await tick();c.poll();await tick();c.requests[1].resolve({ok:true,unbound:true});await tick();
 assert.equal(c.navigation.at(-1).url,'/pages/pair/index');assert.equal(p.data.pageReady,false);assert.equal(c.service.contentReady(),false);assert.equal(p.data.tip,null);p.onHide();
 const d=client();await ready(d);const hidden=d.page('home');d.initial.role='cook';const role=d.service.sync(true);await tick();d.requests[1].resolve({...d.initial,role:'cook'});await role;d.show(hidden);hidden.onLoad({});hidden.onShow();await tick();d.poll();await tick();d.show(d.page('history'));
 d.requests[2].resolve({...d.initial,role:'guest',state:undefined,unchanged:true});await tick();assert.equal(d.navigation.length,0);hidden.onHide();
});
