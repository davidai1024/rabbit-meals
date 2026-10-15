const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const entry=require('../miniprogram/utils/notification-entry'),history=require('../miniprogram/utils/history-page'),model=require('../miniprogram/utils/planning');
function setup(cached=true){
 entry.receive({});const state=model.initial(),p=model.period(new Date('2026-10-12T12:00:00'));
 for(const type of ['next','weekend']){const plan=model.getPlan(state,type,p);state.plans[plan.key]={...plan,status:'submitted',lines:[]};}
 const old=model.getPlan(state,'next',model.period(new Date('2026-09-28T12:00:00')));state.plans[old.key]={...old,status:'eaten',lines:[]};
 const before=JSON.stringify(state),shared={onLoad(){if(cached)this.load();},onShow(){this.load();},load(){this.state=state;this.refresh();}};
 const page=history.factory(shared,()=>({selectedKey:'',historyType:'all',role:'cook'}));page.setData=value=>Object.assign(page.data,value);
 return {page,state,before};
}
test('通知入口校验日期与编码，拒绝任意路径和非法键',()=>{
 for(const value of ['next:2026-10-19','weekend:2026-10-17','next%3A2026-10-19'])assert.equal(entry.key(value),decodeURIComponent(value));
 for(const value of ['next:2026-02-30','next:2026-13-01','__proto__','../pair/index','next:2026-10-19&clear=true','%broken',null,{},'x'.repeat(80)])assert.equal(entry.key(value),'');
});
test('消息只从历史菜单路径消费，消费一次后不覆盖后续普通浏览',()=>{
 entry.receive({path:'pages/v3-history/index',query:{key:'weekend:2026-10-17'}});assert.equal(entry.take(),'weekend:2026-10-17');assert.equal(entry.take(),'');
 entry.receive({path:'pages/v3-menu/index',query:{key:'next:2026-10-19'}});assert.equal(entry.take(),'');
});
test('当前两种菜单和往期点评消息都直接展开对应详情，不改变使用记录',()=>{
 for(const key of ['next:2026-10-19','weekend:2026-10-17','next:2026-10-05']){const x=setup();x.page.onLoad({key});x.page.onShow();assert.equal(x.page.data.selected.key,key);assert.equal(JSON.stringify(x.state),x.before);}
});
test('无缓存启动先保留消息目标，云端加载后展示详情',()=>{
 const {page}=setup(false);page.onLoad({key:'next%3A2026-10-19'});assert.equal(page.data.selectedKey,'next:2026-10-19');assert.equal(page.data.selected,null);page.onShow();assert.equal(page.data.selected.key,'next:2026-10-19');
});
test('小程序已打开时 App.onShow 的新消息也能切换历史详情',()=>{
 const x=setup();x.page.onLoad({key:'next:2026-10-19'});let app;
 vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/app'),'utf8'),{App:value=>app=value,require:name=>name==='./utils/notification-entry'?entry:{env:''},wx:{}});
 app.onShow({path:'pages/v3-history/index',query:{key:'weekend:2026-10-17'}});x.page.onShow();assert.equal(x.page.data.selected.key,'weekend:2026-10-17');
 x.page.closeDetail();x.page.onShow();assert.equal(x.page.data.selectedKey,'');
});
test('清空后的失效通知与非法查询参数均安全展示列表',()=>{
 for(const key of ['next:2026-08-03','__proto__','%invalid']){const {page}=setup();page.onLoad({key});page.onShow();assert.equal(page.data.selected,null);assert.equal(page.data.history.length,3);}
});
test('从首页查看已点菜单只展示原提交内容，返回不会丢失修改草稿',t=>{
 const x=setup(),key='next:2026-10-19',plan=x.state.plans[key],original=x.state.recipes[0],draft=x.state.recipes[1];
 plan.lines=[{id:original.id,multiplier:1}];plan.draftLines=[{id:draft.id,multiplier:1}];const before=JSON.stringify(x.state);let backs=0;
 const previous=global.wx;global.wx={navigateBack(){backs++;}};t.after(()=>{if(previous===undefined)delete global.wx;else global.wx=previous;});
 x.page.onLoad({key,source:'ordered'});x.page.onShow();assert.equal(x.page.data.orderedView,true);assert.equal(x.page.data.selected.lines[0].id,original.id);x.page.closeDetail();assert.equal(backs,1);assert.equal(JSON.stringify(x.state),before);
 const invalid=setup();invalid.page.onLoad({key:'__proto__',source:'ordered'});assert.equal(invalid.page.data.orderedView,false);
});
test('真实云缓存跳过页面重载时，第二条通知仍更新展示中的菜单详情',async()=>{
 entry.receive({});const path=require('node:path'),dir=path.join(__dirname,'../miniprogram/utils'),stored=new Map(),requests=[];let active;
 const copy=x=>JSON.parse(JSON.stringify(x));
 const wx={getStorageSync:key=>stored.get(key),setStorageSync:(key,value)=>stored.set(key,copy(value)),cloud:{callFunction:()=>new Promise(resolve=>requests.push(value=>resolve({result:copy(value)})))},switchTab(){},navigateTo(){}};
 const context={wx,Date,setTimeout,clearTimeout,setInterval,clearInterval,getCurrentPages:()=>active?[active]:[]};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(dir,'planning-service.js'),'utf8'),{...context,module,require:name=>name==='./config'?{env:'test'}:name==='./service'?{isDemo:()=>false,display:()=>''}:require(path.join(dir,name))});
 const service=module.exports,state=model.initial(),period=model.period();for(const type of ['next','weekend']){const p=model.getPlan(state,type,period);state.plans[p.key]={...p,status:'submitted',lines:[]};}
 const sync=service.sync();await new Promise(setImmediate);requests[0]({ok:true,role:'cook',familyId:'f',revision:1,code:'c',members:2,state});await sync;
 const historyModule={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(dir,'history-page.js'),'utf8'),{...context,module:historyModule,require:name=>name==='./planning-service'?service:name==='./notification-entry'?entry:require(path.join(dir,name))});
 const isolated=new Map([['./planning-service',service],['./history-page',historyModule.exports],['./notification-entry',entry]]),runtime=new Set(['./menu-actions','./swipe-menu','./ordering-pages','./planning-pages','./tips']);
 function load(name){
  if(isolated.has(name))return isolated.get(name);
  if(!runtime.has(name))return require(path.join(dir,name));
  const module={exports:{}};isolated.set(name,module.exports);vm.runInNewContext(fs.readFileSync(path.join(dir,name+'.js'),'utf8'),{...context,module,require:load});isolated.set(name,module.exports);return module.exports;
 }
 const definition=load('./planning-pages').history(),updates=[];active={...definition,route:'pages/v3-history/index',data:copy(definition.data),setData(value){updates.push(value);Object.assign(this.data,value);}};
 const first=model.planKey('next',period),second=model.planKey('weekend',period);active.onLoad({key:first});active.onShow();await new Promise(setImmediate);assert.equal(active.data.selected.key,first);
 updates.length=0;entry.receive({path:'pages/v3-history/index',query:{key:second}});active.onShow();await new Promise(setImmediate);
 assert.equal(active.data.selected.key,second);assert.equal(updates.filter(value=>'plan' in value).length,0);assert.equal(requests.length,1);active.onHide();
});
