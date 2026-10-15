'use strict';
const model=require('./planning'),life=require('./menu-lifecycle');
const submittedStatuses=new Set(['submitted','confirmed','cooked','eaten']);
function dateText(value,currentYear){
 const date=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return '';
 return (date.slice(0,4)!==currentYear?Number(date.slice(0,4))+'年':'')+Number(date.slice(5,7))+'月'+Number(date.slice(8,10))+'日';
}
function progress(plan,records,lines){
 const done=lines.filter(line=>(line.tasks||{}).cook).length;
 const reviewed=lines.filter(line=>records.some(record=>record.key===plan.key&&record.recipeId===line.id&&record.role==='guest')).length;
 if(plan.status==='eaten'||(lines.length&&done===lines.length&&reviewed===lines.length))return {badge:'已完成',tone:'complete'};
 if(plan.status==='cooked'||(lines.length&&done===lines.length))return {badge:'已做好 · 待点评',tone:'ready'};
 if(done)return {badge:'制作中 · '+done+'/'+lines.length,tone:'cooking'};
 return plan.status==='submitted'?{badge:'待大厨接单',tone:'waiting'}:{badge:'已接单',tone:'accepted'};
}
function card(plan,state,role,period,display,isCurrent){
 // A saved selection is a draft; the feed always presents the menu the cook received.
 const lines=(plan.lines||[]).filter(line=>!line.cancelled),recipes=plan.recipes||state.recipes||[];
 const photos=lines.slice(0,isCurrent?6:4).map(line=>{const recipe=recipes.find(recipe=>recipe.id===line.id)||{};return {id:line.id,name:recipe.name||line.id,image:display(recipe)};});
 const locked=life.locked(plan),currentYear=String(period.week||period.sat||'').slice(0,4);
 const dateRange=dateText(plan.start,currentYear)+' — '+dateText(plan.end,currentYear);
 const title=isCurrent?(plan.type==='weekend'?'周末的饭已点好':'下周的饭已点好'):dateText(plan.start,currentYear)+'的饭';
 const status=progress(plan,state.records||[],lines);
 return {key:plan.key,type:plan.type,isCurrent,title,dateRange,photos,count:lines.length,...status,locked,
  canModify:isCurrent&&role==='guest'&&!locked,
  canConfirm:isCurrent&&role==='cook'&&plan.status==='submitted'&&!locked,
  draftHint:isCurrent&&role==='guest'&&!locked&&Array.isArray(plan.draftLines)?(life.draftIntent(plan)==='replacement'?'有一篮重新选的菜，原菜单仍有效。':'有一份修改草稿，重新提交前原菜单仍有效。'):'',
  subtitle:!isCurrent?'一餐一餐，都是一起吃过的日子。':status.tone==='complete'?'这一餐收好啦，下次还想吃什么？':status.tone==='ready'?(role==='cook'?'饭已经做好啦，等她来点评。':'饭已经做好啦，记得给大厨写点评。'):locked?'大厨已经开火，安心等饭香。':role==='cook'?(plan.status==='submitted'?'想吃的都交过来啦，等你接单。':'这一餐交给你，慢慢做也很香。'):'想吃的都安排上啦，接下来交给大厨。'};
}
function feed(state,role,period,display=recipe=>recipe.image||''){
 const plans=Object.values(state.plans||{}).filter(plan=>submittedStatuses.has(plan.status)&&['next','weekend'].includes(plan.type)&&Array.isArray(plan.lines)&&plan.lines.some(line=>!line.cancelled));
 const currentKeys=['next','weekend'].map(type=>model.planKey(type,period));
 const currentOrders=currentKeys.map(key=>plans.find(plan=>plan.key===key)).filter(Boolean).map(plan=>card(plan,state,role,period,display,true));
 const pastOrders=plans.filter(plan=>!currentKeys.includes(plan.key)&&plan.start<(plan.type==='next'?period.week:period.sat)).sort((a,b)=>b.start.localeCompare(a.start)||a.type.localeCompare(b.type)).map(plan=>card(plan,state,role,period,display,false));
 return {currentOrders,pastOrders,hasOrdered:!!(currentOrders.length||pastOrders.length)};
}
module.exports={feed};
