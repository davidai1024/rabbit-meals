'use strict';
const test=require('node:test'),a=require('node:assert/strict');
const client=require('../miniprogram/utils/planning'),cloud=require('../cloudfunctions/planningFamily/planning');
const life=require('../miniprogram/utils/menu-lifecycle');
const period=client.period(new Date('2026-10-13T12:00:00+08:00'));
function fixture(model=client){
 let state=model.initial();state.recipes.forEach(r=>{r.purchaseVerified=true;r.meals=3;});
 const type='next',key=model.planKey(type,period),lines=state.recipes.map(r=>({id:r.id,multiplier:1}));
 const act=(action,data={},role='guest',now=1000)=>state=model.apply(state,role,action,{type,period,...data},now);
 return {model,act,lines,key,get:()=>state,plan:()=>model.getPlan(state,type,period),submit(){act('selectDraft',{lines});act('submitMenu');},confirm(){act('confirm',{},'cook',2000);}};
}
for(const [name,model] of [['client',client],['cloud',cloud]]){
 test(name+': first submission has new intent and clears the basket fields',()=>{
  const x=fixture(model);x.act('selectDraft',{lines:x.lines});a.equal(x.plan().draftIntent,'new');x.act('submitMenu');
  a.equal(x.plan().draftIntent,undefined);a.equal(x.plan().draftLines,undefined);a.equal(x.plan().lines.length,6);a.equal(x.plan().status,'submitted');
 });
 test(name+': picking again creates a replacement basket without mutating the committed order',()=>{
  const x=fixture(model);x.submit();x.confirm();const committed=structuredClone(x.plan()),shopping=model.shopping(x.get(),period);
  x.act('selectDraft',{lines:x.lines.slice(0,2)});a.equal(x.plan().draftIntent,'replacement');a.equal(life.label(x.plan()),'重新点菜 · 待提交');
  a.deepEqual(x.plan().lines,committed.lines);a.equal(x.plan().status,'confirmed');a.equal(x.plan().submittedAt,1000);a.equal(x.plan().confirmedAt,2000);a.deepEqual(model.shopping(x.get(),period),shopping);
  x.act('discardDraft');a.equal(x.plan().draftIntent,undefined);a.equal(x.plan().draftLines,undefined);a.deepEqual(x.plan().lines,committed.lines);
 });
 test(name+': replacing requires an explicit boolean confirmation and keeps one effective order',()=>{
  const x=fixture(model);x.submit();x.confirm();x.get().ledger[period.key]={retained:{name:'购买记录',bought:2}};
  x.act('selectDraft',{lines:x.lines.map((l,i)=>i?l:{...l,spice:'辣',note:'这次换口味'})});const before=structuredClone(x.get());
  for(const replaceConfirmed of [undefined,false,'true',1])a.throws(()=>x.act('submitMenu',{replaceConfirmed}),/确认是否换成/);
  a.deepEqual(x.get(),before);x.act('submitMenu',{replaceConfirmed:true},'guest',3000);
  a.equal(Object.keys(x.get().plans).length,1);a.equal(x.plan().status,'submitted');a.equal(x.plan().lines[0].spice,'辣');a.equal(x.plan().submittedAt,3000);
  a.equal(x.plan().confirmedAt,undefined);a.equal(x.plan().draftLines,undefined);a.equal(x.plan().draftIntent,undefined);a.equal(x.get().ledger[period.key].retained.bought,2);
 });
 test(name+': editing original order requires confirming discard of a nonempty replacement basket',()=>{
  const x=fixture(model);x.submit();x.act('selectDraft',{lines:x.lines.slice(1)});const before=structuredClone(x.get());
  a.throws(()=>x.act('startEdit'),/确认放弃/);a.deepEqual(x.get(),before);
  x.act('startEdit',{discardReplacement:true});a.equal(x.plan().draftIntent,'edit');a.deepEqual(x.plan().draftLines,x.plan().lines);
  x.act('selectDraft',{lines:x.lines.map((l,i)=>i?l:{...l,note:'不要香菜'})});const editing=structuredClone(x.get());x.act('startEdit');a.deepEqual(x.get(),editing);
  x.act('submitMenu',{},'guest',4000);a.equal(x.plan().lines[0].note,'不要香菜');a.equal(x.plan().submittedAt,4000);
 });
 test(name+': an empty replacement basket can become an original-order edit without another discard confirmation',()=>{
  const x=fixture(model);x.submit();x.act('selectDraft',{lines:[]});x.act('startEdit');a.equal(x.plan().draftIntent,'edit');a.equal(x.plan().draftLines.length,6);
 });
 test(name+': same choices in a different order clear draft only and preserve confirmation, snapshots, and history',()=>{
  const x=fixture(model);x.submit();x.confirm();x.plan().lines[0].tasks={prep:true};x.plan().lines[0].storage='冷藏';x.plan().lines[0].actualMultiplier=2;
  const committed=structuredClone(x.plan()),log=structuredClone(x.get().log);
  x.act('selectDraft',{lines:x.lines.slice().reverse()});const version=x.plan().version;
  x.act('submitMenu',{},'guest',5000);a.equal(x.plan().version,version+1);a.equal(x.plan().status,'confirmed');a.equal(x.plan().confirmedAt,2000);
  a.equal(x.plan().submittedAt,1000);a.equal(x.plan().updatedAt,committed.updatedAt);a.deepEqual(x.plan().lines,committed.lines);a.deepEqual(x.plan().recipes,committed.recipes);a.deepEqual(x.get().log,log);
  a.equal(x.plan().draftLines,undefined);a.equal(x.plan().draftIntent,undefined);
 });
 test(name+': editing and resubmitting identical choices is not a new effective submission',()=>{
  const x=fixture(model);x.submit();x.confirm();const log=structuredClone(x.get().log);x.act('startEdit');x.act('submitMenu',{},'guest',6000);
  a.equal(x.plan().status,'confirmed');a.equal(x.plan().submittedAt,1000);a.equal(x.plan().confirmedAt,2000);a.deepEqual(x.get().log,log);a.equal(x.plan().draftIntent,undefined);
 });
 test(name+': incidental weekend metadata does not turn identical next-week choices into a replacement',()=>{
  const x=fixture(model);x.submit();x.confirm();const committed=structuredClone(x.plan()),log=structuredClone(x.get().log);
  a.ok(committed.lines.every(l=>l.day===''&&l.meal===''));
  x.act('selectDraft',{lines:x.lines.map(l=>({...l,day:period.sat,meal:'午餐',people:2,fresh:false}))});x.act('submitMenu',{},'guest',6100);
  a.equal(x.plan().status,'confirmed');a.equal(x.plan().confirmedAt,committed.confirmedAt);a.equal(x.plan().submittedAt,committed.submittedAt);a.deepEqual(x.plan().lines,committed.lines);a.deepEqual(x.get().log,log);a.equal(x.plan().draftLines,undefined);
  x.act('selectDraft',{lines:x.lines.map((l,i)=>i?l:{...l,spice:'少辣',day:period.sat,meal:'午餐'})});a.throws(()=>x.act('submitMenu'),/确认是否换成/);
 });
 test(name+': weekend schedule and serving choices still require a real replacement confirmation',()=>{
  const x=fixture(model),original={id:x.lines[0].id,multiplier:1,day:period.sat,meal:'午餐',people:1,fresh:true};
  x.act('selectDraft',{type:'weekend',lines:[original]});x.act('submitMenu',{type:'weekend'});
  for(const change of [{day:period.sun},{meal:'晚餐'},{people:2},{fresh:false}]){
   x.act('selectDraft',{type:'weekend',lines:[{...original,...change}]});a.throws(()=>x.act('submitMenu',{type:'weekend'}),/确认是否换成/);x.act('discardDraft',{type:'weekend'});
  }
 });
 test(name+': a cook completion racing replacement submission locks every editing action',()=>{
  const x=fixture(model);x.submit();x.confirm();x.act('selectDraft',{lines:x.lines.map((l,i)=>i?l:{...l,spice:'少辣'})});
  x.act('task',{id:x.lines[0].id,task:'cook',checked:true},'cook',7000);const before=structuredClone(x.get());
  for(const [action,data] of [['submitMenu',{replaceConfirmed:true}],['selectDraft',{lines:[]}],['startEdit',{discardReplacement:true}]])a.throws(()=>x.act(action,data),/开始制作/);
  a.deepEqual(x.get(),before);x.act('discardDraft');a.equal(x.plan().draftLines,undefined);a.ok(x.plan().lines[0].tasks.cook);
 });
 test(name+': legacy edit drafts remain edits, but caller cannot spoof fresh replacement intent',()=>{
  const x=fixture(model);x.submit();x.confirm();x.act('startEdit');delete x.plan().draftIntent;
  a.equal(life.draftIntent(x.plan()),'edit');x.act('selectDraft',{lines:x.lines.map((l,i)=>i?l:{...l,note:'少盐'})});a.equal(x.plan().draftIntent,'edit');x.act('submitMenu');
  x.act('selectDraft',{lines:x.lines.map((l,i)=>i?l:{...l,note:'多盐'}),draftIntent:'edit'});a.equal(x.plan().draftIntent,'replacement');a.throws(()=>x.act('submitMenu'),/确认是否换成/);
 });
 test(name+': unavailable committed dishes are not silently accepted into a fresh replacement basket',()=>{
  const x=fixture(model);x.submit();x.get().recipes[0].hidden=true;
  a.throws(()=>x.act('selectDraft',{lines:x.lines}),/隐藏/);
  x.act('startEdit');x.act('selectDraft',{lines:x.lines});a.equal(x.plan().draftIntent,'edit');a.throws(()=>x.act('submitMenu'),/隐藏/);
 });
 test(name+': next-week and weekend replacement checks are independent',()=>{
  const x=fixture(model);x.submit();const weekendLines=[{id:x.lines[0].id,multiplier:1,day:period.sat,meal:'午餐',people:1}];
  x.act('selectDraft',{type:'weekend',lines:weekendLines});x.act('submitMenu',{type:'weekend'});
  a.equal(Object.keys(x.get().plans).length,2);a.equal(model.getPlan(x.get(),'weekend',period).draftIntent,undefined);
  x.act('selectDraft',{type:'weekend',lines:weekendLines.map(l=>({...l,note:'周末换口味'}))});a.throws(()=>x.act('submitMenu',{type:'weekend'}),/确认是否换成/);
  x.act('submitMenu',{type:'weekend',replaceConfirmed:true});a.equal(x.plan().submittedAt,1000);a.equal(x.plan().lines.length,6);a.equal(model.getPlan(x.get(),'weekend',period).lines[0].note,'周末换口味');
 });
}
test('order comparison ignores weekend metadata only when explicitly comparing next-week menus',()=>{
 const original=[{id:'recipe',portions:3,multiplier:1,spice:'不辣',note:''}],scheduled=[{...original[0],day:period.sat,meal:'午餐',people:2,fresh:false}];
 a.equal(life.sameOrder(original,scheduled),false);a.equal(life.sameOrder(original,scheduled,'weekend'),false);a.equal(life.sameOrder(original,scheduled,'next'),true);
 for(const change of [{id:'other'},{spice:'少辣'},{note:'不要香菜'},{portions:4},{multiplier:2}])a.equal(life.sameOrder(original,[{...scheduled[0],...change}],'next'),false);
});
test('client and cloud menu lifecycle implementations are identical',()=>{
 const fs=require('node:fs'),path=require('node:path');a.equal(fs.readFileSync(path.join(__dirname,'../miniprogram/utils/menu-lifecycle.js'),'utf8'),fs.readFileSync(path.join(__dirname,'../cloudfunctions/planningFamily/menu-lifecycle.js'),'utf8'));
});
