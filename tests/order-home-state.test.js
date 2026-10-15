require('./helpers/configure-cloud');
const test=require('node:test'),a=require('node:assert/strict');
const model=require('../miniprogram/utils/planning'),life=require('../miniprogram/utils/menu-lifecycle'),service=require('../miniprogram/utils/planning-service'),pages=require('../miniprogram/utils/planning-pages');
const clone=x=>JSON.parse(JSON.stringify(x)),event=dataset=>({currentTarget:{dataset}});
let store=new Map(),toasts=[],navigation=[];
global.wx={getStorageSync:k=>store.get(k),setStorageSync:(k,v)=>store.set(k,clone(v)),hideToast(){},showToast:o=>toasts.push(o),navigateTo:o=>navigation.push(o),switchTab:o=>navigation.push(o),showModal:o=>o.success({confirm:true})};
function page(name='menu'){const def=pages[name]();return {...def,route:'pages/v3-'+name+'/index',data:clone(def.data),updates:[],setData(patch){this.updates.push(patch);Object.assign(this.data,patch);}};}
function setup(type='next'){
 store=new Map();toasts=[];navigation=[];service.setRole('guest');service.select(type,0);
 const state=service.state();state.recipes.forEach(r=>{r.purchaseVerified=true;r.meals=3;});wx.setStorageSync(service.KEY,state);
 const p=page();p.load();return p;
}
function selectSix(p){const recipes=service.state().recipes.filter(model.complete),lines=['meat','veg'].flatMap(kind=>recipes.filter(r=>r.kind===kind).slice(0,3)).map(r=>({id:r.id,multiplier:1}));p.change('selectDraft',{lines});return lines;}
async function submitSix(p){selectSix(p);await p.submit();return clone(p.data.submittedPlan);}
function differentSix(original){
 const state=service.state(),kind=state.recipes.find(r=>r.id===original.lines[0].id).kind;
 const replacement=state.recipes.find(r=>r.kind===kind&&!original.lines.some(l=>l.id===r.id)&&model.complete(r));
 a.ok(replacement);const lines=clone(original.lines);lines[0]={...lines[0],id:replacement.id};return {lines,replacement};
}
async function confirmMenu(p,original){service.setRole('cook');service.call('confirm',{period:p.data.period,type:'next',version:original.version});service.setRole('guest');p.load();}
function sameIds(actual,expected){a.deepEqual(actual.map(l=>l.id),expected.map(l=>l.id));}
test('提交后点菜页保持空购物篮，已有单只显示提示且不自动跳页',async()=>{
 const p=setup(),original=await submitSix(p);
 a.equal(p.data.orderNotice.visible,true);a.equal(p.data.orderNotice.locked,false);a.match(p.data.orderNotice.text,/6.*替换/);
 a.equal(p.data.total,0);a.equal(p.data.lines.length,0);a.equal(p.data.plan.lines.length,0);a.equal(p.data.selectedThumbs.length,0);
 a.equal(p.data.cardReady,true);a.ok(p.data.card);a.equal(p.data.filtered.find(r=>r.id===original.lines[0].id).selected,false);
 a.equal(p.data.editingDraft,false);a.equal(p.data.busy,false);a.equal(toasts.length,0);a.equal(navigation.length,0);a.match(p.data.submissionNote,/大厨|已点|饭香/);
 sameIds(model.getPlan(service.state(),'next',p.data.period).lines,original.lines);
 p.load();a.equal(p.data.total,0);a.equal(p.data.cardReady,true);a.equal(p.data.orderNotice.visible,true);
});
test('已提交后可以直接从空篮重新选菜，不需要先点击修改',async()=>{
 const p=setup(),original=await submitSix(p);toasts=[];
 p.switchView(event({mode:'list'}));p.pickDish(event({id:original.lines[0].id}));
 a.equal(p.data.total,1);a.equal(p.data.editingDraft,false);a.equal(p.data.hasDraft,true);a.equal(life.draftIntent(p.data.submittedPlan),'replacement');
 a.equal(p.data.filtered.find(r=>r.id===original.lines[0].id).selected,true);a.equal(p.data.submissionNote,'');a.equal(toasts.length,0);
 sameIds(p.data.submittedPlan.lines,original.lines);p.pickDish(event({id:original.lines[0].id}));a.equal(p.data.total,0);a.equal(p.data.cardReady,true);
});
test('新篮再次提交先确认替换，取消保留选择和原菜单，确认才生效',async()=>{
 const p=setup(),original=await submitSix(p),purchase=clone(model.shopping(service.state(),p.data.period)),next=differentSix(original);
 p.change('selectDraft',{lines:next.lines});a.equal(p.data.editingDraft,false);a.equal(p.data.total,6);toasts=[];
 await p.submit();a.ok(p.data.tip);a.equal(p.data.tip.confirmText,'替换菜单');a.equal(p.data.tip.cancelText,'取消');a.match(p.data.tip.content,/下周|本周期/);a.match(p.data.tip.content,/整份替换/);
 sameIds(p.data.submittedPlan.lines,original.lines);a.deepEqual(clone(model.shopping(service.state(),p.data.period)),purchase);
 await p.tipDismiss();a.equal(p.data.tip,null);a.equal(p.data.total,6);sameIds(p.data.plan.lines,next.lines);sameIds(p.data.submittedPlan.lines,original.lines);
 await p.submit();a.ok(p.data.tip);await p.tipConfirm();
 a.equal(p.data.total,0);a.equal(p.data.editingDraft,false);a.equal(p.data.submittedPlan.status,'submitted');sameIds(p.data.submittedPlan.lines,next.lines);
 a.equal(p.data.submittedPlan.draftLines,undefined);a.equal(p.data.tip,null);a.equal(p.data.busy,false);a.equal(toasts.length,0);a.ok(p.data.submissionNote);
});
test('已点修改预填原菜单，未重新提交时原菜单和采购保持有效',async()=>{
 const p=setup(),original=await submitSix(p),purchase=clone(model.shopping(service.state(),p.data.period));toasts=[];p.updates=[];
 await p.modify();a.equal(p.data.editingDraft,true);a.equal(p.data.total,6);sameIds(p.data.plan.lines,original.lines);
 a.equal(p.data.cardReady,true);a.equal(p.data.actionLabel,'重新提交菜单');a.equal(p.data.busy,false);a.equal(p.data.modifyingMenu,false);
 a.equal(toasts.length,0);a.ok(p.updates.every(x=>x.busy!==true));
 p.remove(event({id:original.lines[0].id}));a.equal(p.data.total,5);sameIds(p.data.submittedPlan.lines,original.lines);
 a.deepEqual(clone(model.shopping(service.state(),p.data.period)),purchase);await p.submit();a.match(p.data.error,/选满/);
 a.equal(p.data.editingDraft,true);a.equal(p.data.total,5);sameIds(p.data.submittedPlan.lines,original.lines);
});
test('大厨确认后显式修改仍可提交，不要求新篮替换确认并清除原确认',async()=>{
 const p=setup(),original=await submitSix(p);await confirmMenu(p,original);a.equal(p.data.menuLocked,false);
 await p.modify();p.remove(event({id:original.lines[0].id}));const next=differentSix(original);p.pickDish(event({id:next.replacement.id}));
 a.equal(p.data.editingDraft,true);a.equal(p.data.submittedPlan.status,'confirmed');toasts=[];await p.submit();
 a.equal(p.data.tip,null);a.equal(p.data.total,0);a.equal(p.data.editingDraft,false);a.equal(p.data.submittedPlan.status,'submitted');
 a.equal(p.data.submittedPlan.confirmedAt,undefined);a.equal(p.data.submittedPlan.draftLines,undefined);a.ok(p.data.submittedPlan.lines.some(l=>l.id===next.replacement.id));a.equal(toasts.length,0);
});
test('取消修改有二次确认，确认后恢复空篮并保留已提交菜单',async()=>{
 const p=setup(),original=await submitSix(p);await p.modify();p.remove(event({id:original.lines[0].id}));toasts=[];
 p.cancelOrderEdit();a.ok(p.data.tip);await p.tipDismiss();a.equal(p.data.editingDraft,true);a.equal(p.data.total,5);
 p.cancelOrderEdit();await p.tipConfirm();a.equal(p.data.editingDraft,false);a.equal(p.data.total,0);a.equal(p.data.hasDraft,false);
 a.equal(p.data.cardReady,true);sameIds(p.data.submittedPlan.lines,original.lines);a.equal(toasts.length,0);
});
test('查看已点始终打开已提交快照，不混入新篮与预填修改',async()=>{
 const p=setup(),original=await submitSix(p);await p.modify();p.remove(event({id:original.lines[0].id}));
 const selected=clone(service.selection());p.viewOrderedMenu();a.equal(navigation.at(-1).url,'/pages/v3-history/index?source=ordered&key='+encodeURIComponent(original.key));a.deepEqual(service.selection(),selected);
 const history=page('history');history.onLoad({key:original.key,source:'ordered'});history.load();a.equal(history.data.orderedView,true);a.equal(history.data.selected.lines.length,6);sameIds(history.data.selected.lines,original.lines);
 const feed=page('week');feed.load();a.equal(feed.data.currentOrders.length,1);a.equal(feed.data.currentOrders[0].count,6);a.equal(feed.data.currentOrders[0].canModify,true);
 sameIds(feed.data.lines,original.lines);a.ok(feed.data.currentOrders[0].draftHint);a.equal(p.data.total,5);
});
test('任一道做好后锁定选菜，但分类和视图仍可浏览，原菜单不被并发草稿替换',async()=>{
 const p=setup(),original=await submitSix(p);await confirmMenu(p,original);await p.modify();p.remove(event({id:original.lines[0].id}));
 service.setRole('cook');const plan=model.getPlan(service.state(),'next',p.data.period);service.call('task',{period:p.data.period,type:'next',version:plan.version,id:original.lines[0].id,task:'cook',checked:true});service.setRole('guest');p.load();
 a.equal(p.data.orderNotice.visible,true);a.equal(p.data.orderNotice.locked,true);a.equal(p.data.menuLocked,true);a.equal(p.data.editingDraft,false);
 a.equal(p.data.cardReady,false);a.equal(p.data.total,0);a.ok(p.data.filtered.length);sameIds(p.data.submittedPlan.lines,original.lines);
 const before=JSON.stringify(service.state());p.pickDish();await p.modify();a.equal(JSON.stringify(service.state()),before);a.match(p.data.error,/开始制作|开做/);
 p.switchView(event({mode:'list'}));p.category(event({value:'素菜'}));a.equal(p.data.viewMode,'list');a.ok(p.data.filtered.every(r=>r.kind==='veg'));a.equal(JSON.stringify(service.state()),before);
 const feed=page('week');feed.load();a.equal(feed.data.currentOrders[0].badge,'制作中 · 1/6');a.equal(feed.data.currentOrders[0].canModify,false);
});
test('下周和周末购物篮与提交各自独立，新周期从空菜单开始',async()=>{
 const p=setup();await submitSix(p);p.type(event({type:'weekend'}));a.equal(p.data.orderNotice.visible,false);a.equal(p.data.total,0);
 p.pickDish();await p.submit();a.equal(p.data.orderNotice.visible,true);a.match(p.data.orderNotice.text,/周末/);a.equal(p.data.total,0);a.equal(p.data.submittedPlan.lines.length,1);
 p.type(event({type:'next'}));a.equal(p.data.total,0);a.equal(p.data.orderNotice.visible,true);a.equal(p.data.submittedPlan.lines.length,6);
 const feed=page('week');feed.load();a.equal(feed.data.currentOrders.length,2);a.deepEqual(feed.data.currentOrders.map(x=>x.count),[6,1]);
 const newPeriod=model.period(new Date(Date.now()+7*86400000)),next=model.getPlan(service.state(),'next',newPeriod);a.equal(next.status,'draft');a.equal(next.lines.length,0);
});
test('已点卡片菜名和图片来自提交快照，点菜库仍显示实时内容',async()=>{
 const p=setup(),original=await submitSix(p),state=service.state(),recipe=state.recipes.find(r=>r.id===original.lines[0].id);
 recipe.name='修改后的菜库名字';wx.setStorageSync(service.KEY,state);p.load();a.equal(p.data.filtered.find(r=>r.id===recipe.id).name,recipe.name);
 const feed=page('week');feed.load();const card=feed.data.currentOrders[0];a.equal(card.count,6);a.equal(card.photos.length,6);
 a.equal(card.photos[0].name,original.recipes.find(r=>r.id===original.lines[0].id).name);a.notEqual(card.photos[0].name,recipe.name);
});
test('同菜重新提交也先弹半屏确认，取消保留新篮，确认后不重复接单并保留原确认采购',async()=>{
 const p=setup(),original=await submitSix(p);await confirmMenu(p,original);
 const confirmed=clone(p.data.submittedPlan),log=clone(service.state().log),purchase=clone(model.shopping(service.state(),p.data.period));
 p.change('selectDraft',{lines:clone(confirmed.lines).reverse()});a.equal(p.data.editingDraft,false);a.equal(p.data.total,6);toasts=[];await p.submit();
 a.ok(p.data.tip);a.equal(p.data.tip.confirmText,'替换菜单');a.equal(p.data.tip.cancelText,'取消');a.match(p.data.tip.content,/一样|相同/);a.equal(p.data.total,6);a.equal(p.data.submittedPlan.status,'confirmed');
 const waiting=clone(service.state());await p.tipDismiss();a.equal(p.data.tip,null);a.deepEqual(service.state(),waiting);a.equal(p.data.total,6);sameIds(p.data.plan.lines,clone(confirmed.lines).reverse());sameIds(p.data.submittedPlan.lines,confirmed.lines);
 await p.submit();a.ok(p.data.tip);await p.tipConfirm();
 a.equal(p.data.tip,null);a.equal(p.data.total,0);a.equal(p.data.submittedPlan.status,'confirmed');a.equal(p.data.submittedPlan.confirmedAt,confirmed.confirmedAt);
 a.equal(p.data.submittedPlan.submittedAt,confirmed.submittedAt);a.deepEqual(service.state().log,log);a.deepEqual(clone(model.shopping(service.state(),p.data.period)),purchase);a.equal(toasts.length,0);
});
test('周末已有单再次提交也使用半屏替换确认，取消不发提交请求，确认只写一次',async()=>{
 const p=setup('weekend');p.pickDish();await p.submit();const original=clone(p.data.submittedPlan);a.equal(p.data.tip,null);
 p.change('selectDraft',{lines:clone(original.lines)});const previous=service.call;let submits=0,input;
 service.call=(action,data)=>{if(action==='submitMenu'){submits++;input=clone(data);}return previous(action,data);};
 try{
  const before=clone(service.state());await p.submit();a.ok(p.data.tip);a.match(p.data.tip.title,/周末/);a.equal(p.data.tip.confirmText,'替换菜单');a.equal(p.data.tip.cancelText,'取消');a.equal(submits,0);a.equal(p.data.busy,false);a.equal(p.data.total,1);
  await p.tipDismiss();a.equal(submits,0);a.deepEqual(service.state(),before);a.equal(p.data.total,1);sameIds(p.data.submittedPlan.lines,original.lines);
  await p.submit();a.equal(submits,0);await p.tipConfirm();a.equal(submits,1);a.equal(input.replaceConfirmed,true);a.equal(p.data.total,0);sameIds(p.data.submittedPlan.lines,original.lines);a.equal(p.data.submittedPlan.submittedAt,original.submittedAt);a.equal(p.data.tip,null);
 }finally{service.call=previous;}
});
test('已有新篮时修改原菜单先确认放弃，取消不会丢已选菜',async()=>{
 const p=setup(),original=await submitSix(p),next=differentSix(original);p.change('selectDraft',{lines:next.lines});
 await p.modify();a.ok(p.data.tip);a.equal(p.data.editingDraft,false);sameIds(p.data.plan.lines,next.lines);await p.tipDismiss();sameIds(p.data.plan.lines,next.lines);
 await p.modify();await p.tipConfirm();a.equal(p.data.editingDraft,true);sameIds(p.data.plan.lines,original.lines);sameIds(p.data.submittedPlan.lines,original.lines);
});
test('切换大厨和重新进入点餐页面不会把原菜单灌回购物篮',async()=>{
 const p=setup(),original=await submitSix(p);service.setRole('cook');const work=page('week');work.load();a.equal(work.data.currentOrders[0].count,6);a.equal(work.data.currentOrders[0].canConfirm,true);
 service.setRole('guest');const fresh=page();fresh.load();a.equal(fresh.data.total,0);a.equal(fresh.data.cardReady,true);a.equal(fresh.data.orderNotice.visible,true);sameIds(fresh.data.submittedPlan.lines,original.lines);
 const replacement=differentSix(original);fresh.change('selectDraft',{lines:replacement.lines});service.setRole('cook');work.load();a.equal(work.data.currentOrders[0].count,6);a.equal(work.data.currentOrders[0].photos[0].id,original.lines[0].id);
 service.setRole('guest');const resumed=page();resumed.load();a.equal(resumed.data.editingDraft,false);sameIds(resumed.data.plan.lines,replacement.lines);sameIds(resumed.data.submittedPlan.lines,original.lines);
});
test('已点卡片修改会切到对应餐单，点菜页面带入原菜且仍须重新提交',async()=>{
 const p=setup(),original=await submitSix(p);p.type(event({type:'weekend'}));const orders=page('week');orders.load();toasts=[];navigation=[];
 await orders.modify(event({type:'next',key:original.key}));a.equal(service.selection().type,'next');a.equal(navigation.at(-1).url,'/pages/v3-menu/index');
 const picker=page();picker.load();a.equal(picker.data.editingDraft,true);a.equal(picker.data.actionLabel,'重新提交菜单');sameIds(picker.data.plan.lines,original.lines);a.equal(toasts.length,0);
});
test('已点页切换身份回到概览，同身份离开返回保留已打开详情',async()=>{
 const p=setup(),original=await submitSix(p);service.setRole('cook');const orders=page('week');orders.load();a.equal(orders.data.view,'overview');
 orders.openPlan(event({type:'next',key:original.key}));a.equal(orders.data.view,'menu');orders.onHide();orders.load();a.equal(orders.data.view,'menu');a.equal(orders.data.role,'cook');
 service.setRole('guest');orders.load();a.equal(orders.data.view,'overview');a.equal(orders.data.role,'guest');a.equal(orders.data.currentOrders[0].key,original.key);
 orders.openPlan(event({type:'next',key:original.key}));a.equal(orders.data.view,'menu');orders.onHide();orders.load();a.equal(orders.data.view,'menu');a.equal(orders.data.role,'guest');sameIds(orders.data.lines,original.lines);
 service.setRole('cook');orders.load();a.equal(orders.data.view,'overview');sameIds(orders.data.submittedPlan.lines,original.lines);
});
test('替换提交在云端等待时禁止重复提交，成功后空篮且只写一次',async()=>{
 const p=setup(),original=await submitSix(p),next=differentSix(original);p.change('selectDraft',{lines:next.lines});await p.submit();const previous=service.call;let resolve,calls=0;
 service.call=(action,data)=>action==='submitMenu'?new Promise(r=>{calls++;resolve=()=>r(previous(action,data));}):previous(action,data);
 try{toasts=[];const pending=p.tipConfirm();a.equal(p.data.busy,true);await p.submit();a.equal(calls,1);a.equal(p.data.tip,null);sameIds(p.data.submittedPlan.lines,original.lines);
  resolve();await pending;a.equal(p.data.busy,false);a.equal(p.data.total,0);sameIds(p.data.submittedPlan.lines,next.lines);a.equal(calls,1);a.equal(toasts.length,0);
 }finally{service.call=previous;}
});
test('替换确认期间远端做好，确认后拒绝覆盖并刷新锁定提示',async()=>{
 const p=setup(),original=await submitSix(p);await confirmMenu(p,original);const next=differentSix(original);p.change('selectDraft',{lines:next.lines});await p.submit();a.ok(p.data.tip);
 service.setRole('cook');const latest=model.getPlan(service.state(),'next',p.data.period);service.call('task',{period:p.data.period,type:'next',version:latest.version,id:original.lines[0].id,task:'cook',checked:true});service.setRole('guest');
 toasts=[];await p.tipConfirm();a.equal(p.data.menuLocked,true);a.equal(p.data.orderNotice.locked,true);sameIds(p.data.submittedPlan.lines,original.lines);a.equal(p.data.total,0);a.match(p.data.error,/开始制作|开做/);a.equal(toasts.length,0);
});
test('替换请求失败保留本次购物篮和原菜单，不显示提交成功',async()=>{
 const p=setup(),original=await submitSix(p),next=differentSix(original);p.change('selectDraft',{lines:next.lines});await p.submit();a.ok(p.data.tip);
 const previous=service.call;service.call=(action,data)=>{if(action==='submitMenu')throw Error('网络暂时没连上');return previous(action,data);};
 try{toasts=[];await p.tipConfirm();a.equal(p.data.total,6);sameIds(p.data.plan.lines,next.lines);sameIds(p.data.submittedPlan.lines,original.lines);a.equal(p.data.submissionNote,'');a.match(p.data.error,/网络/);a.equal(p.data.busy,false);a.equal(toasts.length,0);}finally{service.call=previous;}
});
test('云端修改等待时仅修改按钮加载，查看仍可用，成功才预填',async()=>{
 const p=setup(),original=await submitSix(p),previous=service.call;let resolve;
 service.call=(action,data)=>action==='startEdit'?new Promise(r=>{resolve=()=>r(previous(action,data));}):previous(action,data);
 try{toasts=[];const work=p.modify();a.equal(p.data.modifyingMenu,true);a.equal(p.data.busy,false);a.equal(p.data.total,0);p.viewOrderedMenu();
  a.equal(navigation.at(-1).url,'/pages/v3-history/index?source=ordered&key='+encodeURIComponent(original.key));resolve();await work;
  a.equal(p.data.editingDraft,true);a.equal(p.data.total,6);a.equal(p.data.modifyingMenu,false);a.equal(p.data.busy,false);a.equal(toasts.length,0);
 }finally{service.call=previous;}
});
test('修改请求期间远端做好，失败刷新锁定且不清原菜单',async()=>{
 const p=setup(),original=await submitSix(p),previous=service.call;await confirmMenu(p,original);let reject;
 service.call=(action,data)=>action==='startEdit'?new Promise((r,j)=>{reject=j;}):previous(action,data);
 try{const work=p.modify();service.setRole('cook');const fresh=model.getPlan(service.state(),'next',p.data.period);previous('task',{period:p.data.period,type:'next',version:fresh.version,id:original.lines[0].id,task:'cook',checked:true});service.setRole('guest');reject(Error('菜单已开始制作，不能再改菜'));await work;
  a.equal(p.data.orderNotice.locked,true);a.equal(p.data.total,0);a.equal(p.data.modifyingMenu,false);a.equal(p.data.busy,false);a.equal(p.data.submittedPlan.draftLines,undefined);sameIds(p.data.submittedPlan.lines,original.lines);
 }finally{service.call=previous;}
});
test('远端做好与本机待保存草稿冲突，空篮仍可恢复并解除其他餐单写入屏障',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),catalog=require('../miniprogram/utils/catalog-migration');
 const dir=path.join(__dirname,'../miniprogram/utils'),stored=new Map(),period=model.period(),server={state:catalog.migrate(model.initial()),revision:1};
 server.state.recipes.forEach(r=>{r.purchaseVerified=true;r.meals=3;});
 const selected=['meat','veg'].flatMap(kind=>server.state.recipes.filter(r=>r.kind===kind&&!r.hidden).slice(0,3)).map(r=>({id:r.id,multiplier:1}));
 for(const action of ['selectDraft','submitMenu'])server.state=model.apply(server.state,'guest',action,{type:'next',period,lines:selected});
 server.state=model.apply(server.state,'cook','confirm',{type:'next',period});server.state=model.apply(server.state,'guest','startEdit',{type:'next',period});
 let release,gate=true;const held=new Promise(r=>release=r),metadata=()=>({ok:true,role:'guest',familyId:'home-race',revision:server.revision,members:2,code:'test'});
 const cloudWx={getStorageSync:k=>stored.get(k),setStorageSync:(k,v)=>stored.set(k,clone(v)),hideToast(){},showToast(){},switchTab(){},navigateTo(){},cloud:{callFunction:async({data:request})=>{
  if(request.action==='get')return {result:request.revision===server.revision?{...metadata(),unchanged:true}:{...metadata(),state:clone(server.state)}};
  if(request.action==='selectDraft'&&gate){gate=false;await held;}
  if(request.data.expectedRevision!==server.revision)return {result:{ok:false,error:'另一位已更新菜单，请刷新后再操作'}};
  try{server.state=model.apply(server.state,'guest',request.action,request.data);server.revision++;return {result:{...metadata(),state:clone(server.state)}};}catch(error){return {result:{ok:false,error:error.message}};}
 }}};
 let cloudService,cloudFlow,cloudSwipe,cloudOrdering;
 function load(file){const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(dir,file+'.js'),'utf8'),{module,wx:cloudWx,Date,setTimeout,clearTimeout,setInterval,clearInterval,require:name=>name==='./planning-service'?cloudService:name==='./menu-actions'?cloudFlow:name==='./swipe-menu'?cloudSwipe:name==='./ordering-pages'?cloudOrdering:require(path.join(dir,name))});return module.exports;}
 cloudService=load('planning-service');cloudFlow=load('menu-actions');cloudSwipe=load('swipe-menu');cloudOrdering=load('ordering-pages');const cloudPages=load('planning-pages');
 await cloudService.sync(true);const def=cloudPages.menu(),p={...def,route:'pages/v3-menu/index',data:clone(def.data),setData(patch){Object.assign(this.data,patch);}};p.load();
 a.equal(p.data.editingDraft,true);p.change('selectDraft',{lines:selected.slice(1)});await new Promise(r=>setImmediate(r));
 const confirmed=model.getPlan(server.state,'next',period);server.state=model.apply(server.state,'cook','task',{type:'next',period,version:confirmed.version,id:selected[0].id,task:'cook',checked:true});server.revision++;
 release();await a.rejects(cloudService.flushDraft(),/另一位/);a.equal(p.data.draftSync.phase,'conflict');a.equal(p.data.draftSync.pending,true);
 a.equal(p.data.orderNotice.visible,true);a.equal(p.data.orderNotice.locked,true);a.equal(p.data.total,0);sameIds(p.data.submittedPlan.lines,selected);
 p.resolveDraftConflict();a.ok(p.data.tip);a.match(p.data.tip.content,/采用|另一位/);await p.tipConfirm();
 a.equal(p.data.draftSync.phase,'idle');a.equal(p.data.draftSync.pending,false);a.equal(stored.get(cloudService.DRAFT_KEY),null);a.equal(p.data.orderNotice.locked,true);a.equal(p.data.total,0);
 p.type(event({type:'weekend'}));a.equal(p.data.orderNotice.visible,false);p.pickDish();await cloudService.flushDraft();a.equal(model.getPlan(server.state,'weekend',period).draftLines.length,1);a.equal(p.data.busy,false);
});
