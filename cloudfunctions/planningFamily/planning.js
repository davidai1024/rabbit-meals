'use strict';
const d=require('./domain'),lifecycle=require('./menu-lifecycle');
const copy=d.clone, round=d.round;
function dateKey(date=new Date()){const x=new Date(date);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;}
function addDays(key,n){const x=new Date(key+'T12:00:00');x.setDate(x.getDate()+n);return dateKey(x);}
function period(date=new Date(),offset=0){const mon=d.weekKey(date,false),week=addDays(mon,7+offset*7),sat=addDays(mon,5+offset*7);return {week,sat,sun:addDays(sat,1),end:addDays(week,6),key:sat};}
function planKey(type,p){return type+':'+(type==='next'?p.week:p.sat);}
function initial(old){return {schema:3,recipes:(old?copy(old.recipes):d.seed().recipes).map(r=>({...r,standard:r.base||2,minutes:r.minutes||30,method:r.method||'',freeze:r.freeze||'待大厨确认',purchaseVerified:!!r.purchaseVerified,hidden:!!r.hidden})),plans:{},ledger:{},favorites:{guest:[],cook:[]},requests:[],records:[],legacy:old?copy(old.plans):{},log:[]};}
function getPlan(s,type,p){return s.plans[planKey(type,p)]||{key:planKey(type,p),type,start:type==='next'?p.week:p.sat,end:type==='next'?p.end:p.sun,lines:[],status:'draft',version:0};}
function counts(s,p){let meat=0,veg=0;const seen=new Set();for(const l of p.lines){if(l.cancelled||seen.has(l.id))continue;seen.add(l.id);const r=(p.recipes||s.recipes).find(x=>x.id===l.id);if(r&&r.kind==='meat')meat++;else if(r&&r.kind==='veg')veg++;}return {meat,veg,valid:p.type==='weekend'||(meat===3&&veg===3)};}
const alias={'马铃薯':'土豆','西红柿':'番茄','蒜':'大蒜','蒜头':'大蒜'};
function ingredient(raw){const i=d.normalize(raw);return {...i,name:alias[i.name]||i.name,spec:String(raw.spec||'').trim()};}
function ingredientKey(i){return [i.name,i.spec,i.unit].join('|');}
function complete(r){return !!r&&(r.purchaseVerified||r.catalogReady)&&Array.isArray(r.ingredients)&&r.ingredients.length>0&&r.ingredients.every(i=>{try{return ingredient(i).qty>0&&ingredient(i).name}catch(e){return false;}});}
function required(s,p,scope='all'){const sums={},missing=[];for(const type of ['next','weekend']){if(scope!=='all'&&scope!==type)continue;const plan=getPlan(s,type,p);if(plan.status==='draft')continue;for(const l of plan.lines){if(l.cancelled)continue;const r=(plan.recipes||s.recipes).find(x=>x.id===l.id);if(!complete(r)){missing.push(r?r.name:l.id);continue;}for(const raw of (l.ingredients||r.ingredients)){const i=ingredient(raw),key=ingredientKey(i);if(!sums[key])sums[key]={key,name:i.name,spec:i.spec,unit:i.unit,need:0,sources:[]};const amount=round(i.qty*l.multiplier);sums[key].need+=amount;sums[key].sources.push({type,label:type==='next'?'下周':'周末',dish:r.name,qty:amount,multiplier:l.multiplier});}}}return {sums,missing};}
function purchaseView(b,totalNeed,sources){
 const signature=JSON.stringify(sources.map(x=>[x.type,x.dish,x.qty]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
 const explicit=['pending','bought','home'].includes(b.checklistStatus);
 const stale=explicit&&b.checklistStatus!=='pending'&&b.checklistSignature!==signature;
 const legacy=b.stock>=totalNeed&&totalNeed>0?'home':(b.bought>0&&(b.bought+(b.stock||0)>=totalNeed))?'bought':'pending';
 const purchaseState=explicit?(stale?'pending':b.checklistStatus):legacy;
 return {purchaseState,purchaseReady:purchaseState!=='pending',purchaseStale:stale,purchaseSignature:signature,purchaseRevision:b.checklistRevision||0};
}
function shopping(s,p,scope='all'){const {sums,missing}=required(s,p,scope),ledger=s.ledger[p.key]||{};const all=required(s,p,'all').sums;const keys=new Set([...Object.keys(sums),...(scope==='all'?Object.keys(ledger):[])]);return {missing,items:[...keys].map(key=>{const x=sums[key]||{key,name:ledger[key].name,spec:ledger[key].spec||'',unit:ledger[key].unit,need:0,sources:[]};const b=ledger[key]||{},totalNeed=all[key]?round(all[key].need):0,stock=b.stock||0,bought=b.bought||0;const target=b.override==null?round(Math.max(0,totalNeed-stock)):b.override;return {...x,...purchaseView(b,totalNeed,all[key]?.sources||[]),need:round(x.need),totalNeed,stock,bought,target,remaining:round(Math.max(0,target-bought)),surplus:round(Math.max(0,bought-target)),delta:round(totalNeed-(b.baseline==null?totalNeed:b.baseline)),actual:b.actual||0,budget:b.budget||0,override:b.override,adjustment:b.adjustment||''};}).sort((a,b)=>a.name.localeCompare(b.name,'zh'))};}
function checkRole(role,wanted){if(role!==wanted)throw Error(wanted==='cook'?'请切换为大厨身份':'请切换为点餐身份');}
function validatedLines(s,input,type,p){if(!Array.isArray(input))throw Error('菜单格式错误');const seen=new Set();return input.map(l=>{const r=s.recipes.find(x=>x.id===l.id);if(!r)throw Error('菜单中的菜品已不存在，请在已选菜品中取消后再提交');if(r.hidden)throw Error(r.name+'已'+(r.archived?'归档':'隐藏')+'，请在已选菜品中取消或替换后再提交');if(seen.has(l.id))throw Error('同一道菜请调整制作量，不重复占名额');seen.add(l.id);if(!complete(r))throw Error(r.name+'的采购数据待大厨核实，请先补全');const out={...l,multiplier:d.num(l.multiplier,.25,20),note:d.text(l.note||'',200),spice:l.spice||'不辣'};if(!['不辣','少辣','辣'].includes(out.spice))throw Error('请选择辣度');if(type==='weekend'){if(![p.sat,p.sun].includes(l.day))throw Error('请选择周六或周日');if(!['早餐','午餐','晚餐'].includes(l.meal))throw Error('请选择餐次');out.people=d.num(l.people||1,1,20);}return out;});}
function apply(state,role,action,data={},now=Date.now()){const s=copy(state),p=data.period;if(!['guest','cook'].includes(role))throw Error('请先选择身份');
 if(action==='favorite'){s.favorites[role]=s.favorites[role]||[];const f=s.favorites[role],idx=f.indexOf(data.id);if(idx<0)f.push(data.id);else f.splice(idx,1);return s;}
 if(action==='request'){checkRole(role,'guest');if(!String(data.name||'').trim())throw Error('请填写想吃的菜名');s.requests.push({id:'req-'+now,name:d.text(data.name,40),note:d.text(data.note||'',200),status:'待补录',at:now});return s;}
 if(action==='recipe'){checkRole(role,'cook');const r=copy(data.recipe);if(!r.id||!r.name)throw Error('请填写菜名');if(!Array.isArray(r.ingredients))throw Error('请填写采购食材');if(!['meat','veg'].includes(r.kind))throw Error('确认荤菜或素菜分类');r.name=d.text(r.name,40);r.category=r.kind==='meat'?'荤菜':'素菜';r.meals=d.num(r.meals==null?3:r.meals,1,20);if(!Number.isInteger(r.meals))throw Error('饭顿数请填写1到20的整数');if(Array.isArray(r.tasteTags)){r.tasteTags=[...new Set(r.tasteTags.map(t=>d.text(t,40)))].filter(Boolean);r.taste=r.tasteTags.join('、');}r.ingredients=r.ingredients.map(ingredient);if(r.purchaseVerified&&(!r.ingredients.length||r.ingredients.some(i=>!i.name||!i.qty)))throw Error('核实采购前请补全食材和购买量');const idx=s.recipes.findIndex(x=>x.id===r.id);if(idx<0)s.recipes.push(r);else s.recipes[idx]=r;if(data.requestId){const request=s.requests.find(x=>x.id===data.requestId);if(request){request.status=complete(r)?'已补录':'待补录';request.recipeId=r.id;}}return s;}
 if(action==='hide'){checkRole(role,'cook');const r=s.recipes.find(x=>x.id===data.id);if(!r)throw Error('菜品不存在');r.hidden=!r.hidden;return s;}
 if(action==='purchaseAll'){
  checkRole(role,'cook');
  if(!['all','next','weekend'].includes(data.scope))throw Error('请选择买菜范围');
  if(!Array.isArray(data.items)||!data.items.length)throw Error('请刷新买菜清单后重试');
  const pending=shopping(s,p,data.scope).items.filter(x=>x.totalNeed>0&&!x.purchaseReady),snapshots=new Map();
  for(const x of data.items){
   if(!x||typeof x.key!=='string'||snapshots.has(x.key))throw Error('清单已变化，请刷新后重新确认');
   snapshots.set(x.key,x);
  }
  if(snapshots.size!==pending.length||pending.some(item=>{const x=snapshots.get(item.key);return !x||x.signature!==item.purchaseSignature||x.revision!==item.purchaseRevision;}))throw Error('清单已变化，请刷新后重新确认');
  s.ledger[p.key]=s.ledger[p.key]||{};
  for(const item of pending){const old=s.ledger[p.key][item.key]||{};s.ledger[p.key][item.key]={...old,name:item.name,spec:item.spec,unit:item.unit,checklistStatus:'bought',checklistSignature:item.purchaseSignature,checklistRevision:item.purchaseRevision+1,checklistAt:now};}
  return s;
 }
 if(action==='purchaseStatus'){
  checkRole(role,'cook');
  if(!['pending','bought','home'].includes(data.status))throw Error('请选择买菜状态');
  const item=shopping(s,p).items.find(x=>x.key===data.key&&x.totalNeed>0);
  if(!item)throw Error('这项食材已不在当前清单中');
  if(data.signature!==item.purchaseSignature||data.revision!==item.purchaseRevision)throw Error('清单已变化，请刷新后重新确认');
  s.ledger[p.key]=s.ledger[p.key]||{};const old=s.ledger[p.key][item.key]||{};
  s.ledger[p.key][item.key]={...old,name:item.name,spec:item.spec,unit:item.unit,checklistStatus:data.status,checklistSignature:item.purchaseSignature,checklistRevision:item.purchaseRevision+1,checklistAt:now};return s;
 }
 if(action==='purchase'){checkRole(role,'cook');const item=shopping(s,p).items.find(x=>x.key===data.key);if(!item)throw Error('食材不存在');s.ledger[p.key]=s.ledger[p.key]||{};const old=s.ledger[p.key][item.key]||{};s.ledger[p.key][item.key]={...old,name:item.name,spec:item.spec,unit:item.unit,stock:d.num(data.stock),bought:d.num(data.bought),override:data.override===''||data.override==null?null:d.num(data.override),adjustment:d.text(data.adjustment||'',200),actual:d.num(data.actual||0),budget:d.num(data.budget||0),baseline:item.totalNeed,at:now};return s;}
 const type=data.type||'next',key=planKey(type,p),old=getPlan(s,type,p);
 if(data.version!=null&&Number(data.version)!==old.version)throw Error('菜单已变更，请刷新后再操作');
 if(['save','submit','reuse','cancelLine','suggest'].includes(action)&&lifecycle.locked(old))throw Error('菜单已开始制作，不能再改菜');
 if(old.status!=='draft'&&['save','submit','cancelLine'].includes(action)){checkRole(role,'guest');throw Error('请用最新版点菜界面重新提交，原菜单不能直接修改或取消');}
 if(action==='reuse'){checkRole(role,'guest');return lifecycle.apply(s,role,'selectDraft',{...data,draftIntent:'replacement'},old,now,{validatedLines,counts});}
 const handled=lifecycle.apply(s,role,action,data,old,now,{validatedLines,counts});if(handled)return handled;
 if(['save','submit','reuse'].includes(action)){checkRole(role,'guest');const lines=validatedLines(s,data.lines,type,p);const status=action==='submit'?'submitted':old.status==='draft'?'draft':'submitted';if(action==='submit'&&!lines.length)throw Error('先选一道菜');const next={...old,lines,status,version:old.version+1,updatedAt:now,recipes:copy(s.recipes.filter(r=>lines.some(l=>l.id===r.id)))};if(type==='next'&&counts(s,next).meat>3||type==='next'&&counts(s,next).veg>3){if(action==='submit')throw Error('下周最多3荤3素，请移除超额菜品');}s.plans[key]=next;delete next.confirmedAt;s.log.push({key,at:now,message:action==='submit'?'提交菜单':'调整菜单，需重新确认',before:copy(old.lines),after:copy(lines)});return s;}
 if(action==='confirm'){checkRole(role,'cook');if(['confirmed','cooked','eaten'].includes(old.status))return s;if(old.status==='draft'||!old.lines.length)throw Error('请先由点餐人提交');if(!counts(s,old).valid)throw Error('下周必须恰好3荤3素');if(old.lines.some(l=>!complete((old.recipes||s.recipes).find(r=>r.id===l.id))))throw Error('请补齐并核实采购数据');s.plans[key]={...old,status:'confirmed',confirmedAt:now,version:old.version+1};return s;}
 if(action==='suggest'){checkRole(role,'cook');if(!old.lines.length||old.status==='draft')throw Error('提交菜单后才能提议调整');if(!String(data.note||'').trim())throw Error('请填写调整建议');s.plans[key]={...old,status:'submitted',suggestion:d.text(data.note,200),version:old.version+1};return s;}
 if(action==='cancelLine'){checkRole(role,'guest');const next={...old,lines:old.lines.filter(l=>l.id!==data.id),status:old.status==='draft'?'draft':'submitted',version:old.version+1};s.plans[key]=next;s.log.push({key,at:now,message:'取消菜品，采购已重新计算'});return s;}
 if(action==='task'){checkRole(role,'cook');if(!['confirmed','cooked','eaten'].includes(old.status))throw Error('菜单确认后再执行做饭任务');const l=copy(old.lines.find(x=>x.id===data.id));if(!l)throw Error('菜品不存在');l.tasks=l.tasks||{};if(!['prep','cook','portion','freeze'].includes(data.task))throw Error('未知做饭任务');if(!data.checked&&data.task==='cook'&&s.records.some(r=>r.key===key&&r.recipeId===l.id))throw Error('已有用餐反馈，不能撤销制作');if(data.task==='portion'&&data.checked&&!l.tasks.cook)throw Error('请先完成制作再分装');if(data.task==='freeze'&&data.checked){if(!l.storage||!l.storage.includes('冷冻')||!l.eatDate||!l.reheat)throw Error('请先填写保存方式、预计食用日和复热方法');if(!l.tasks.cook||!l.tasks.portion)throw Error('请先完成制作与分装');}l.tasks[data.task]=!!data.checked;if(!data.checked&&data.task==='cook'){l.tasks.portion=false;l.tasks.freeze=false;}if(!data.checked&&data.task==='portion')l.tasks.freeze=false;if(data.task==='cook'&&data.checked)l.actualMultiplier=l.actualMultiplier||l.multiplier;const lines=old.lines.map(x=>x.id===l.id?l:x);s.plans[key]={...old,lines,status:lines.every(x=>(x.tasks||{}).cook)?(lines.every(x=>s.records.some(r=>r.key===key&&r.recipeId===x.id))?'eaten':'cooked'):'confirmed',version:old.version+1};return s;}
 if(action==='storage'){checkRole(role,'cook');if(!['confirmed','cooked','eaten'].includes(old.status))throw Error('菜单确认后再记录保存安排');const l=copy(old.lines.find(x=>x.id===data.id));if(!l)throw Error('菜品不存在');if(data.eatDate&&!(data.eatDate>=old.start&&data.eatDate<=old.end))throw Error('预计食用日应在菜单日期范围内');Object.assign(l,{storage:d.text(data.storage||'',100),eatDate:data.eatDate||'',reheat:d.text(data.reheat||'',200),actualMultiplier:d.num(data.actualMultiplier||l.multiplier,.25,20)});if(l.tasks&&l.tasks.freeze&&(!l.storage.includes('冷冻')||!l.eatDate||!l.reheat))l.tasks.freeze=false;s.plans[key]={...old,lines:old.lines.map(x=>x.id===l.id?l:x),version:old.version+1};return s;}
 if(action==='record'){checkRole(role,'guest');if(!['吃完了','有剩余','不够吃','吃完'].includes(data.result))throw Error('请选择实际吃饭结果');const l=old.lines.find(x=>x.id===data.id);if(!l||!(l.tasks||{}).cook)throw Error('实际做过后才能记录用餐反馈');const previous=s.records.findIndex(r=>r.key===key&&r.recipeId===l.id&&r.role===role),record={id:previous<0?'record-'+now+'-'+s.records.length:s.records[previous].id,key,recipeId:l.id,type,at:now,role,amount:l.actualMultiplier||l.multiplier,result:data.result,note:d.text(data.note||'',200),again:!!data.again};if(previous<0)s.records.push(record);else s.records[previous]=record;s.plans[key]={...old,status:old.lines.every(l=>s.records.some(r=>r.key===key&&r.recipeId===l.id))?'eaten':old.status,version:old.version+1};return s;}
 throw Error('未知操作');
}
function stats(s){
 const favorites={},frequency={};
 for(const rec of s.records)if(rec.again)favorites[rec.recipeId]=(favorites[rec.recipeId]||0)+1;
 let cooked=0;
 for(const p of Object.values(s.plans)){
  const seen=new Set();
  for(const l of p.lines)if(!l.cancelled&&(l.tasks||{}).cook&&!seen.has(l.id)){
   seen.add(l.id);cooked++;frequency[l.id]=(frequency[l.id]||0)+1;
  }
 }
 const rank=counts=>Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([id,count])=>({id,count,name:(s.recipes.find(x=>x.id===id)||{}).name||id}));
 const mostCooked=rank(frequency),max=mostCooked[0]?.count||1;
 return {libraryCount:s.recipes.filter(r=>!r.archived).length,availableCount:s.recipes.filter(r=>!r.hidden).length,cookedKinds:Object.keys(frequency).length,cooked,feedback:s.records.length,again:s.records.filter(x=>x.again).length,mostCooked:mostCooked.map((x,i)=>({...x,rank:i+1,percent:Math.round(x.count/max*100)})),top:rank(favorites),records:s.records.slice().reverse()};
}
module.exports={dateKey,addDays,period,planKey,initial,getPlan,counts,ingredient,ingredientKey,complete,shopping,apply,stats};
