'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const client=require('../miniprogram/utils/planning'),cloud=require('../cloudfunctions/planningFamily/planning');
const period=client.period(new Date('2026-10-13T12:00:00+08:00'));
function fixture(model){
 let state=model.initial();state.recipes.forEach(r=>{r.purchaseVerified=true;r.meals=3;});
 const lines=state.recipes.map(r=>({id:r.id,multiplier:1,spice:'不辣'}));
 const act=(action,data={},role='guest')=>state=model.apply(state,role,action,{period,type:'next',...data},1000);
 return {lines,act,get:()=>state,plan:()=>model.getPlan(state,'next',period),submit(){act('selectDraft',{lines});act('submitMenu');}};
}
for(const [name,model] of [['client',client],['cloud',cloud]]){
 for(const status of ['submitted','confirmed'])test(name+': legacy writes cannot bypass replacement confirmation when '+status,()=>{
  const x=fixture(model);x.submit();if(status==='confirmed')x.act('confirm',{},'cook');const before=structuredClone(x.get());
  for(const action of ['save','submit','cancelLine'])a.throws(()=>x.act(action,{lines:x.lines.slice(1),id:x.lines[0].id,replaceConfirmed:true}),/最新版点菜界面/);
  a.deepEqual(x.get(),before);a.equal(x.plan().status,status);
 });
 test(name+': legacy writes remain rejected even while a valid edit draft exists',()=>{
  const x=fixture(model);x.submit();x.act('startEdit');const before=structuredClone(x.get());
  for(const action of ['save','submit','cancelLine'])a.throws(()=>x.act(action,{lines:x.lines,id:x.lines[0].id}),/最新版点菜界面/);
  a.deepEqual(x.get(),before);a.equal(x.plan().draftIntent,'edit');
 });
 test(name+': initial legacy draft save, cancellation, and first submission remain compatible',()=>{
  const x=fixture(model);x.act('save',{lines:x.lines});a.equal(x.plan().status,'draft');x.act('cancelLine',{id:x.lines[0].id});a.equal(x.plan().lines.length,5);
  x.act('save',{lines:x.lines});x.act('submit',{lines:x.lines});a.equal(x.plan().status,'submitted');a.equal(x.plan().lines.length,6);
 });
 test(name+': reuse becomes a replacement draft and cannot spoof edit intent to overwrite an existing order',()=>{
  const x=fixture(model);x.submit();x.act('confirm',{},'cook');x.act('startEdit');const committed=structuredClone(x.plan().lines),shopping=model.shopping(x.get(),period);
  x.act('reuse',{lines:x.lines.map((l,i)=>i?l:{...l,note:'复用菜谱'}),draftIntent:'edit'});a.equal(x.plan().draftIntent,'replacement');a.equal(x.plan().status,'confirmed');
  a.deepEqual(x.plan().lines,committed);a.deepEqual(model.shopping(x.get(),period),shopping);a.throws(()=>x.act('submitMenu'),/确认是否换成/);
  x.act('submitMenu',{replaceConfirmed:true});a.equal(x.plan().status,'submitted');a.equal(x.plan().lines[0].note,'复用菜谱');
 });
 test(name+': reuse on an initial period produces new intent without requiring a replacement confirmation',()=>{
  const x=fixture(model);x.act('reuse',{lines:x.lines,draftIntent:'edit'});a.equal(x.plan().draftIntent,'new');x.act('submitMenu');a.equal(x.plan().status,'submitted');
 });
 test(name+': cook completion lock takes precedence over legacy API compatibility',()=>{
  const x=fixture(model);x.submit();x.act('confirm',{},'cook');x.act('task',{id:x.lines[0].id,task:'cook',checked:true},'cook');const before=structuredClone(x.get());
  for(const action of ['save','submit','cancelLine','reuse'])a.throws(()=>x.act(action,{lines:x.lines,id:x.lines[0].id,replaceConfirmed:true}),/开始制作/);
  a.deepEqual(x.get(),before);
 });
 test(name+': version and identity checks still reject stale or unauthorized legacy writes',()=>{
  const x=fixture(model);x.submit();a.throws(()=>x.act('save',{lines:x.lines,version:0}),/变更/);a.throws(()=>x.act('save',{lines:x.lines},'cook'),/点餐/);
 });
}
test('client and cloud planning implementations stay identical after legacy-operation guards',()=>{
 a.equal(fs.readFileSync(path.join(__dirname,'../miniprogram/utils/planning.js'),'utf8'),fs.readFileSync(path.join(__dirname,'../cloudfunctions/planningFamily/planning.js'),'utf8'));
});
