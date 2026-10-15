const test=require('node:test'),a=require('node:assert/strict');
const {command,applyUpdate}=require('./helpers/cloud-update');
const models=[['本机',require('../miniprogram/utils/planning')],['云端',require('../cloudfunctions/planningFamily/planning')]];

function fixture(m){
 const period=m.period(new Date('2026-10-12T12:00:00'));
 let state=m.initial();
 state.recipes=[
  {id:'next-dish',name:'下周菜',kind:'meat',purchaseVerified:true,ingredients:[['土豆',300],['白菜',200],['番茄',100],['黄瓜',50],['胡萝卜',150]].map(([name,qty])=>({name,qty,unit:'克'}))},
  {id:'weekend-dish',name:'周末菜',kind:'veg',purchaseVerified:true,ingredients:[{name:'土豆',qty:100,unit:'克'},{name:'洋葱',qty:80,unit:'克'},{name:'鸡蛋',qty:2,unit:'个'}]}
 ];
 for(const type of ['next','weekend'])state=m.apply(state,'guest','submit',{period,type,lines:[{id:type==='next'?'next-dish':'weekend-dish',multiplier:1,spice:'不辣',day:period.sat,meal:'午餐',people:2}]});
 const item=name=>m.shopping(state,period).items.find(x=>x.name===name);
 const potato=item('土豆'),cabbage=item('白菜');
 state.ledger[period.key]={
  [potato.key]:{name:potato.name,unit:potato.unit,stock:50,bought:75,actual:123,budget:130,override:350,adjustment:'保留采购记录',baseline:77,at:10},
  [cabbage.key]:{name:cabbage.name,unit:cabbage.unit,stock:cabbage.totalNeed,bought:0,actual:20,budget:25}
 };
 for(const [name,status] of [['番茄','home'],['黄瓜','bought']]){
  const x=item(name);
  state=m.apply(state,'cook','purchaseStatus',{period,key:x.key,status,signature:x.purchaseSignature,revision:x.purchaseRevision},20);
 }
 return {state,period};
}
function snapshots(m,state,period,scope='all'){
 return m.shopping(state,period,scope).items.filter(x=>x.totalNeed>0&&!x.purchaseReady).map(x=>({key:x.key,signature:x.purchaseSignature,revision:x.purchaseRevision}));
}

for(const [label,m] of models){
 test(`${label}一键买好：只标待买项，保留已有状态、库存、金额与真实购买量`,()=>{
  const {state,period}=fixture(m),before=structuredClone(state),items=snapshots(m,state,period);
  const result=m.apply(state,'cook','purchaseAll',{period,scope:'all',items},1234);
  a.deepEqual(state,before);
  a.deepEqual(result.plans,before.plans);
  a.ok(m.shopping(result,period).items.every(x=>x.purchaseReady));
  for(const x of items){
   const old=before.ledger[period.key][x.key]||{},entry=result.ledger[period.key][x.key];
   for(const key of ['stock','bought','actual','budget','override','adjustment','baseline','at'])a.equal(entry[key],old[key]);
   a.equal(entry.checklistStatus,'bought');a.equal(entry.checklistSignature,x.signature);a.equal(entry.checklistRevision,x.revision+1);a.equal(entry.checklistAt,1234);
  }
  for(const x of m.shopping(before,period).items.filter(x=>x.purchaseReady))a.deepEqual(result.ledger[period.key][x.key],before.ledger[period.key][x.key]);
 });
 test(`${label}一键买好：仅影响选定范围，重叠食材沿用共享采购状态`,()=>{
  for(const scope of ['next','weekend']){
   const {state,period}=fixture(m),items=snapshots(m,state,period,scope),result=m.apply(state,'cook','purchaseAll',{period,scope,items});
   a.ok(m.shopping(result,period,scope).items.every(x=>x.purchaseReady));
   const other=scope==='next'?'weekend':'next',selected=new Set(items.map(x=>x.key));
   for(const x of m.shopping(state,period,other).items){
    const current=m.shopping(result,period,other).items.find(y=>y.key===x.key);
    a.equal(current.purchaseReady,selected.has(x.key)||x.purchaseReady);
    if(!selected.has(x.key))a.deepEqual(result.ledger[period.key]?.[x.key],state.ledger[period.key]?.[x.key]);
   }
  }
 });
 test(`${label}一键买好：只允许大厨，拒绝非法范围、空快照和重复操作`,()=>{
  const {state,period}=fixture(m),items=snapshots(m,state,period),data={period,scope:'all',items};
  a.throws(()=>m.apply(state,'guest','purchaseAll',data),/大厨/);
  a.throws(()=>m.apply(state,'cook','purchaseAll',{...data,scope:'invalid'}),/范围/);
  for(const invalid of [undefined,[],{}])a.throws(()=>m.apply(state,'cook','purchaseAll',{...data,items:invalid}),/刷新/);
  const result=m.apply(state,'cook','purchaseAll',data);
  a.throws(()=>m.apply(result,'cook','purchaseAll',data),/变化/);
 });
 test(`${label}一键买好：任一需求或状态快照过期都整批拒绝`,()=>{
  const {state,period}=fixture(m),items=snapshots(m,state,period),data={period,scope:'all',items};
  for(const field of ['signature','revision']){
   const invalid=structuredClone(items);invalid[invalid.length-1][field]=field==='signature'?'旧需求':-1;
   const before=structuredClone(state);
   a.throws(()=>m.apply(state,'cook','purchaseAll',{...data,items:invalid}),/变化/);a.deepEqual(state,before);
  }
  const stale=structuredClone(state);stale.plans[m.planKey('weekend',period)].lines[0].multiplier=2;
  a.throws(()=>m.apply(stale,'cook','purchaseAll',data),/变化/);
  const last=items.at(-1),changed=m.apply(state,'cook','purchaseStatus',{period,...last,status:'home'});
  a.throws(()=>m.apply(changed,'cook','purchaseAll',data),/变化/);
  a.equal(m.shopping(changed,period).items.filter(x=>!x.purchaseReady).length,items.length-1);
 });
 test(`${label}一键买好：漏项、新项、重复项或跨范围快照均拒绝`,()=>{
  const {state,period}=fixture(m),items=snapshots(m,state,period),data={period,scope:'all',items};
  for(const invalid of [items.slice(1),[...items,{key:'missing',signature:'[]',revision:0}],[...items,items[0]]])a.throws(()=>m.apply(state,'cook','purchaseAll',{...data,items:invalid}),/变化/);
  a.throws(()=>m.apply(state,'cook','purchaseAll',{...data,scope:'next'}),/变化/);
  const changed=structuredClone(state),plan=changed.plans[m.planKey('weekend',period)];
  plan.lines[0].ingredients=[...changed.recipes[1].ingredients,{name:'豆腐',qty:200,unit:'克'}];
  a.throws(()=>m.apply(changed,'cook','purchaseAll',data),/变化/);
 });
 test(`${label}一键买好：过期完成标记可重新确认，其他周期保留`,()=>{
  const {state,period}=fixture(m),otherPeriod=m.period(new Date('2026-10-12T12:00:00'),1);
  state.ledger[otherPeriod.key]={'无关|克':{name:'无关',unit:'克',bought:42,checklistStatus:'pending'}};
  const tomato=m.shopping(state,period).items.find(x=>x.name==='番茄');
  state.ledger[period.key][tomato.key].checklistSignature='旧需求';
  a.equal(m.shopping(state,period).items.find(x=>x.key===tomato.key).purchaseStale,true);
  const result=m.apply(state,'cook','purchaseAll',{period,scope:'all',items:snapshots(m,state,period)});
  const updated=m.shopping(result,period).items.find(x=>x.key===tomato.key);
  a.equal(updated.purchaseState,'bought');a.equal(updated.purchaseStale,false);
  a.deepEqual(result.ledger[otherPeriod.key],state.ledger[otherPeriod.key]);
 });
}

test('本机与云端采购模型源码保持一致',()=>{
 const fs=require('node:fs');
 a.equal(fs.readFileSync(require.resolve('../miniprogram/utils/planning'),'utf8'),fs.readFileSync(require.resolve('../cloudfunctions/planningFamily/planning'),'utf8'));
});

function mockCloud(){
 const store={};let uid='cook';
 const collection=(data,name)=>({
  doc:id=>({
   get:async()=>{if(!data[name]?.[id])throw Error('not exist');return {data:structuredClone(data[name][id])};},
   set:async({data:entry})=>{data[name][id]=structuredClone(entry);},
   update:async({data:entry})=>{applyUpdate(data[name][id],entry);}
  }),
  where:query=>({limit:()=>({get:async()=>({data:Object.entries(data[name]).filter(([,entry])=>entry.code===query.code).map(([id,entry])=>({...structuredClone(entry),_id:id}))})})})
 });
 const db={
  command,
  collection:name=>collection(store,name),
  createCollection:async name=>{if(store[name])throw Error('already exist');store[name]={};},
  runTransaction:async fn=>{const draft=structuredClone(store),result=await fn({collection:name=>collection(draft,name)});Object.assign(store,draft);return result;}
 };
 return {store,as:value=>{uid=value;},cloud:{database:()=>db,getWXContext:()=>({OPENID:uid}),getTempFileURL:async()=>({fileList:[]})}};
}

test('云函数一键买好：权限与整批快照校验失败不改变饭桌，成功仅提交一次',async()=>{
 const m=models[1][1],x=mockCloud(),h=require('../cloudfunctions/planningFamily/handler').createHandler(x.cloud);
 const created=await h({action:'create',data:{role:'cook'}}),{state,period}=fixture(m);
 a.equal(created.ok,true);
 const family=x.store.mealFamilies[created.familyId];family.state=state;
 const data={period,scope:'all',items:snapshots(m,state,period),expectedRevision:family.revision},before=structuredClone(family);
 x.as('guest');const joined=await h({action:'join',data:{code:created.code,role:'guest'}});a.equal(joined.ok,true);
 data.expectedRevision=joined.revision;
 const denied=await h({action:'purchaseAll',data});a.equal(denied.ok,false);a.match(denied.error,/大厨/);
 a.deepEqual(x.store.mealFamilies[created.familyId].state,state);
 x.as('cook');
 const invalid=structuredClone(data);invalid.items.at(-1).revision=-1;
 const stale=await h({action:'purchaseAll',data:invalid});a.equal(stale.ok,false);a.match(stale.error,/变化/);
 a.equal(x.store.mealFamilies[created.familyId].revision,joined.revision);a.deepEqual(x.store.mealFamilies[created.familyId].state,before.state);
 const result=await h({action:'purchaseAll',data});a.equal(result.ok,true);a.equal(result.revision,joined.revision+1);
 a.ok(m.shopping(result.state,period).items.every(item=>item.purchaseReady));
 const duplicate=await h({action:'purchaseAll',data:{...data,expectedRevision:result.revision}});a.equal(duplicate.ok,false);
 a.equal(x.store.mealFamilies[created.familyId].revision,result.revision);a.deepEqual(x.store.mealFamilies[created.familyId].state,result.state);
});

test('云函数一键买好：饭桌版本变化时拒绝旧请求，保留新的买菜状态',async()=>{
 const m=models[1][1],x=mockCloud(),h=require('../cloudfunctions/planningFamily/handler').createHandler(x.cloud);
 const created=await h({action:'create',data:{role:'cook'}}),{state,period}=fixture(m);
 x.store.mealFamilies[created.familyId].state=state;
 const items=snapshots(m,state,period),last=items.at(-1);
 const changed=await h({action:'purchaseStatus',data:{period,...last,status:'home',expectedRevision:created.revision}});a.equal(changed.ok,true);
 const stale=await h({action:'purchaseAll',data:{period,scope:'all',items,expectedRevision:created.revision}});a.equal(stale.ok,false);a.match(stale.error,/更新/);
 a.deepEqual(x.store.mealFamilies[created.familyId].state,changed.state);
 const retry=await h({action:'purchaseAll',data:{period,scope:'all',items:snapshots(m,changed.state,period),expectedRevision:changed.revision}});a.equal(retry.ok,true);
 a.equal(m.shopping(retry.state,period).items.find(item=>item.key===last.key).purchaseState,'home');
});
