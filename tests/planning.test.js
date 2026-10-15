const test=require('node:test'),assert=require('node:assert/strict'),m=require('../miniprogram/utils/planning');
const period=m.period(new Date('2026-10-08T12:00:00'));
function state(){const s=m.initial();s.recipes.forEach(r=>r.purchaseVerified=true);return s;}
function line(id,multiplier=1){return {id,multiplier,spice:'不辣',day:period.sat,meal:'午餐',people:2};}
function act(s,role,action,data){return m.apply(s,role,action,{period,type:'next',...data});}
const six=['potato-chicken','pepper-pork','braised-pork','tomato-egg','broccoli','cucumber'].map(id=>line(id));
test('3荤2素可保存不可提交，补足3+3后可提交确认',()=>{let s=act(state(),'guest','selectDraft',{lines:six.slice(0,5)});assert.equal(m.getPlan(s,'next',period).status,'draft');assert.equal(m.getPlan(s,'next',period).draftLines.length,5);assert.throws(()=>act(s,'guest','submitMenu',{}),/选满3道荤菜和3道素菜/);assert.throws(()=>act(s,'cook','confirm',{}),/先由点餐人提交/);s=act(s,'guest','selectDraft',{lines:six});s=act(s,'guest','submitMenu',{});s=act(s,'cook','confirm',{});assert.equal(m.getPlan(s,'next',period).status,'confirmed');});
test('周末不占名额，同菜双表来源独立且提交即采购',()=>{let s=act(state(),'guest','submit',{lines:six});s=act(s,'guest','submit',{type:'weekend',lines:[line('potato-chicken'),line('pepper-pork')]});assert.deepEqual(m.counts(s,m.getPlan(s,'next',period)),{meat:3,veg:3,valid:true});const x=m.shopping(s,period).items.find(x=>x.name==='土豆');assert.equal(x.need,600);assert.equal(x.sources.length,2);});
test('500克合并，配方快照在修改期间不变，重提补买且移出原菜保留多买记录',()=>{
 let s=state();const type='weekend',first=s.recipes[0].id,second=s.recipes[1].id,other=s.recipes[2].id;
 s.recipes[0].ingredients=[{name:'马铃薯',qty:600,unit:'克'}];s.recipes[0].meals=6;
 s.recipes[1].ingredients=[{name:'土豆',qty:200,unit:'克'}];s.recipes[1].meals=3;
 s.recipes[2].ingredients=[{name:'青菜',qty:100,unit:'克'}];s.recipes[2].meals=3;
 s=act(s,'guest','selectDraft',{type,lines:[line(first),line(second)]});s=act(s,'guest','submitMenu',{type});
 const potato=()=>m.shopping(s,period).items.find(x=>x.name==='土豆');let x=potato();assert.equal(x.need,500);assert.equal(x.sources.length,2);
 s=act(s,'cook','purchase',{key:x.key,stock:0,bought:500});s.recipes[0].meals=3;
 assert.equal(potato().need,500);s=act(s,'guest','startEdit',{type});s=act(s,'guest','selectDraft',{type,lines:[line(first),line(second)]});assert.equal(potato().need,500);
 s=act(s,'guest','submitMenu',{type});x=potato();assert.equal(x.need,800);assert.equal(x.remaining,300);assert.equal(x.bought,500);
 s=act(s,'guest','startEdit',{type});s=act(s,'guest','selectDraft',{type,lines:[line(second)]});assert.equal(potato().need,800);s=act(s,'guest','submitMenu',{type});assert.equal(potato().surplus,300);
 s=act(s,'guest','startEdit',{type});s=act(s,'guest','selectDraft',{type,lines:[line(other)]});s=act(s,'guest','submitMenu',{type});x=potato();assert.equal(x.need,0);assert.equal(x.bought,500);assert.equal(x.surplus,500);
});
test('确认后修改保留原确认，真正重提撤回确认，新周不占位',()=>{
 let s=act(state(),'guest','selectDraft',{lines:six});s=act(s,'guest','submitMenu',{});s=act(s,'cook','confirm',{});
 const confirmedAt=m.getPlan(s,'next',period).confirmedAt;s=act(s,'guest','startEdit',{});s=act(s,'guest','selectDraft',{lines:six.slice(1)});
 assert.equal(m.getPlan(s,'next',period).status,'confirmed');assert.equal(m.getPlan(s,'next',period).confirmedAt,confirmedAt);assert.equal(m.getPlan(s,'next',period).lines.length,6);
 assert.throws(()=>act(s,'guest','submitMenu',{}),/选满/);s=act(s,'guest','selectDraft',{lines:six.map((l,i)=>i?l:{...l,spice:'少辣'})});s=act(s,'guest','submitMenu',{});
 assert.equal(m.getPlan(s,'next',period).status,'submitted');assert.equal(m.getPlan(s,'next',period).confirmedAt,undefined);assert.equal(m.getPlan(s,'next',period).draftLines,undefined);
 assert.equal(m.getPlan(s,'next',m.period(new Date('2026-10-08T12:00:00'),1)).lines.length,0);
});
test('缺采购数据不混入、角色限制、版本冲突',()=>{assert.throws(()=>act(m.initial(),'guest','submit',{lines:six}),/采购数据/);assert.throws(()=>act(state(),'guest','purchase',{key:'none'}),/大厨/);assert.throws(()=>act(state(),'cook','submit',{lines:six}),/点餐/);assert.throws(()=>act(state(),'guest','submit',{lines:six,version:8}),/变更/);});
test('规格和按个单位不错误合并',()=>{let s=state();s.recipes[0].ingredients=[{name:'鸡蛋',qty:3,unit:'个'},{name:'土豆',qty:300,unit:'克',spec:'小土豆'}];s.recipes[1].ingredients=[{name:'土豆',qty:.2,unit:'千克',spec:'大土豆'}];s=act(s,'guest','submit',{lines:[line(s.recipes[0].id),line(s.recipes[1].id)]});assert.equal(m.shopping(s,period).items.length,3);assert.equal(m.shopping(s,period).items.find(x=>x.unit==='个').need,3);});
test('冷冻须完整保存计划及完成制作分装，反馈真实做后才记',()=>{let s=state();s.recipes.forEach(r=>r.freeze='大厨确认适合冷冻');s=act(s,'guest','submit',{lines:six});s=act(s,'cook','confirm',{});const id=six[0].id;assert.throws(()=>act(s,'cook','task',{id,task:'freeze',checked:true}),/填写/);assert.throws(()=>act(s,'guest','record',{id,result:'吃完'}),/做过/);s=act(s,'cook','storage',{id,storage:'冷冻',eatDate:period.week,reheat:'彻底加热',actualMultiplier:1});assert.throws(()=>act(s,'cook','task',{id,task:'freeze',checked:true}),/制作与分装/);for(const task of ['cook','portion','freeze'])s=act(s,'cook','task',{id,task,checked:true});s=act(s,'guest','record',{id,result:'吃完',again:true});assert.equal(m.stats(s).cooked,1);assert.equal(m.stats(s).again,1);});
