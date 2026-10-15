const test=require('node:test'),a=require('node:assert/strict');
const m=require('../miniprogram/utils/planning'),migration=require('../miniprogram/utils/catalog-migration');
function fixture(type='next'){
 let s=m.initial();s.recipes.forEach(r=>r.purchaseVerified=true);const p=m.period(),data={period:p,type};
 s=m.apply(s,'guest','selectDraft',{...data,lines:s.recipes.map(r=>({id:r.id,multiplier:1,day:p.sat,meal:'午餐'}))});
 s=m.apply(s,'guest','submitMenu',data);s=m.apply(s,'cook','confirm',data);s=m.apply(s,'guest','startEdit',data);
 s=migration.migrate(s);for(const id of ['cucumber','potato-chicken'])Object.assign(s.recipes.find(r=>r.id===id),{hidden:true,archived:true});return {s,p,data};
}
test('两道归档菜可逐一取消，换满后可提交且原菜单与采购在草稿阶段不变',()=>{
 let {s,p,data}=fixture();const original=JSON.stringify(s),plan=m.getPlan(s,'next',p),shopping=m.shopping(s,p);
 for(const id of ['cucumber','potato-chicken']){
  s=m.apply(s,'guest','selectDraft',{...data,lines:m.getPlan(s,'next',p).draftLines.filter(l=>l.id!==id)});
  a.deepEqual(m.getPlan(s,'next',p).lines,plan.lines);a.deepEqual(m.shopping(s,p),shopping);
 }
 a.equal(m.getPlan(s,'next',p).draftLines.length,4);
 s=m.apply(s,'guest','selectDraft',{...data,lines:[...m.getPlan(s,'next',p).draftLines,{id:'mushroom-beef'},{id:'green-beans'}]});
 s=m.apply(s,'guest','submitMenu',data);a.equal(m.getPlan(s,'next',p).status,'submitted');a.equal(m.getPlan(s,'next',p).lines.length,6);a.deepEqual(s.ledger,JSON.parse(original).ledger);
});
test('提交失效菜给具体名称，不能新加隐藏菜，失效菜也不能重复占位',()=>{
 let {s,p,data}=fixture();a.throws(()=>m.apply(s,'guest','submitMenu',data),/已归档/);
 const lines=m.getPlan(s,'next',p).draftLines;a.throws(()=>m.apply(s,'guest','selectDraft',{...data,lines:[...lines,lines.find(l=>l.id==='cucumber')]}),/重复/);
 s=m.apply(s,'guest','selectDraft',{...data,lines:lines.filter(l=>l.id!=='cucumber')});
 a.throws(()=>m.apply(s,'guest','selectDraft',{...data,lines:[...m.getPlan(s,'next',p).draftLines,{id:'cucumber'}]}),/蒜香黄瓜已归档/);
});
test('周末含失效菜可逐道取消；缺失菜可移除，不能提交',()=>{
 let {s,p,data}=fixture('weekend');s.recipes=s.recipes.filter(r=>r.id!=='cucumber');
 s.plans[m.planKey('weekend',p)].draftLines.sort((x,y)=>(y.id==='cucumber')-(x.id==='cucumber'));
 a.throws(()=>m.apply(s,'guest','submitMenu',data),/不存在/);
 for(const id of ['potato-chicken','cucumber'])s=m.apply(s,'guest','selectDraft',{...data,lines:m.getPlan(s,'weekend',p).draftLines.filter(l=>l.id!==id)});
 s=m.apply(s,'guest','submitMenu',data);a.equal(m.getPlan(s,'weekend',p).lines.length,4);
});
test('已开始制作不能借失效菜绕过只读限制',()=>{let {s,p,data}=fixture();s.plans[m.planKey('next',p)].lines[0].tasks={cook:true};a.throws(()=>m.apply(s,'guest','selectDraft',{...data,lines:[]}),/已开始制作/);});
