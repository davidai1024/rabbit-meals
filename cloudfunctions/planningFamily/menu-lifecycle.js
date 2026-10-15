'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function editable(plan,role='guest') {return role==='guest'&&!locked(plan)&&Array.isArray(plan.draftLines)?{...plan,lines:plan.draftLines,recipes:null}:plan;}
function draftIntent(plan){
 if(plan.status==='draft')return 'new';
 if(Array.isArray(plan.draftLines))return plan.draftIntent==='replacement'?'replacement':'edit';
 return 'replacement';
}
function label(plan,role='guest') {if(role==='guest'&&!locked(plan)&&Array.isArray(plan.draftLines)&&plan.status!=='draft')return draftIntent(plan)==='replacement'?'重新点菜 · 待提交':'修改中 · 待重新提交';return {draft:'待提交',submitted:'已提交 · 待大厨确认',confirmed:'已确认',cooked:'已制作',eaten:'已用餐'}[plan.status]||'待提交';}
function locked(plan){return ['cooked','eaten'].includes(plan.status)||plan.lines.some(l=>(l.tasks||{}).cook);}
function fixed(lines,state){return lines.map(l=>{const r=state.recipes.find(r=>r.id===l.id);const meals=Number(r&&r.meals);return {id:l.id,portions:3,multiplier:meals>0?3/meals:1,spice:l.spice||'不辣',note:l.note||'',day:l.day||'',meal:l.meal||'',people:l.people||1,fresh:l.fresh!==false};});}
// Compare choices, not cooking history or the order in which dishes were tapped.
function signature(lines,type){return JSON.stringify(lines.map(l=>({id:l.id,portions:l.portions==null?3:l.portions,multiplier:l.multiplier==null?1:l.multiplier,spice:l.spice||'不辣',note:l.note||'',...(type==='next'?{}:{day:l.day||'',meal:l.meal||'',people:l.people||1,fresh:l.fresh!==false})})).sort((a,b)=>String(a.id).localeCompare(String(b.id))));}
function sameOrder(left,right,type){return signature(left,type)===signature(right,type);}
function withoutDraft(old){const next={...old,version:old.version+1};delete next.draftLines;delete next.draftIntent;return next;}
function apply(s,role,action,data,old,now,api){
 if(!['startEdit','selectDraft','submitMenu','discardDraft'].includes(action))return null;
 if(role!=='guest')throw Error('请切换为点餐身份');
 const key=old.key;
 if(action!=='discardDraft'&&locked(old))throw Error('菜单已开始制作，不能再改菜；可以记录用餐反馈或在历史菜单复用');
 if(action==='startEdit'){
  if(old.status==='draft')return s;
  if(Array.isArray(old.draftLines)&&draftIntent(old)==='edit'){
   if(old.draftIntent==='edit')return s;
   s.plans[key]={...old,draftIntent:'edit',version:old.version+1};return s;
  }
  if(Array.isArray(old.draftLines)&&old.draftLines.length&&data.discardReplacement!==true)throw Error('你已经重新选了一些菜，请确认放弃这些选择后再修改原菜单');
  s.plans[key]={...old,draftLines:clone(old.lines),draftIntent:'edit',version:old.version+1};return s;
 }
 if(action==='discardDraft'){if(!Array.isArray(old.draftLines)&&old.draftIntent==null)return s;s.plans[key]=withoutDraft(old);return s;}
 if(action==='submitMenu'&&!Array.isArray(old.draftLines)&&old.status!=='draft')return s;
 const raw=action==='selectDraft'?data.lines:(old.draftLines||old.lines);
 if(!Array.isArray(raw))throw Error('菜单格式错误');
 const previous=Array.isArray(old.draftLines)?old.draftLines:old.status==='draft'?old.lines:[],seen=new Set();
 const valid=raw.map(l=>{
  if(seen.has(l.id))throw Error('同一道菜请调整制作量，不重复占名额');seen.add(l.id);
  const recipe=s.recipes.find(r=>r.id===l.id),existing=previous.find(x=>x.id===l.id);
  // Keep existing unavailable lines removable in a draft; submission stays strict.
  if(action==='selectDraft'&&existing&&(!recipe||recipe.hidden))return clone(existing);
  return api.validatedLines(s,[{...l,multiplier:1}],old.type,data.period)[0];
 });
 const lines=fixed(valid,s),counts=api.counts(s,{...old,lines,recipes:null});
 if(old.type==='next'&&(counts.meat>3||counts.veg>3))throw Error('每类最多选3道菜，先取消一道再换菜');
 if(action==='selectDraft'){s.plans[key]={...old,draftLines:lines,draftIntent:old.status!=='draft'&&data.draftIntent==='replacement'?'replacement':draftIntent(old),version:old.version+1};return s;}
 if(!lines.length)throw Error('请先选菜再提交');
 if(old.type==='next'&&!counts.valid)throw Error('请选满3道荤菜和3道素菜后提交');
 if(old.status!=='draft'&&sameOrder(old.lines,lines,old.type)){s.plans[key]=withoutDraft(old);return s;}
 if(old.status!=='draft'&&draftIntent(old)==='replacement'&&data.replaceConfirmed!==true)throw Error('本周期已经有一份菜单，请确认是否换成这一份');
 const next={...old,lines,recipes:clone(s.recipes.filter(r=>lines.some(l=>l.id===r.id))),status:'submitted',submittedAt:now,updatedAt:now,version:old.version+1};
 delete next.draftLines;delete next.draftIntent;delete next.confirmedAt;delete next.suggestion;
 s.plans[key]=next;s.log.push({key,at:now,message:old.submittedAt?'修改菜单已重新提交':'菜单已提交',before:clone(old.lines),after:clone(lines)});return s;
}
module.exports={editable,label,fixed,apply,locked,draftIntent,sameOrder};
