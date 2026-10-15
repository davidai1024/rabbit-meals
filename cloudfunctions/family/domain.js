'use strict';
const clone = v => JSON.parse(JSON.stringify(v));
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
function num(v, min = 0, max = 1000000) { const n = Number(v); if (v === '' || v == null || !Number.isFinite(n) || n < min || n > max) throw Error('请输入有效数值'); return n; }
function text(v, max = 200) { if (typeof v !== 'string' || v.length > max) throw Error('文字过长或格式错误'); return v.trim(); }
function weekKey(date = new Date(), next = true) { const d = new Date(date); d.setDate(d.getDate() - (d.getDay() + 6) % 7 + (next ? 7 : 0)); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function validateWeek(w) { if (!/^\d{4}-\d{2}-\d{2}$/.test(w) || Number.isNaN(Date.parse(w))) throw Error('周日期格式错误'); return w; }
function seed() { return { recipes: [
 { id:'tomato-egg', name:'番茄炒蛋', category:'素菜', kind:'veg', taste:'酸甜 · 可选辣度', image:'', imageSource:'ai', base:2, ingredients:[{name:'番茄',qty:300,unit:'克'},{name:'鸡蛋',qty:3,unit:'个'}] },
 { id:'broccoli', name:'蒜蓉西兰花', category:'素菜', kind:'veg', taste:'蒜香 · 清淡', image:'', imageSource:'ai', base:2, ingredients:[{name:'西兰花',qty:350,unit:'克'},{name:'大蒜',qty:10,unit:'克'}] },
 { id:'potato-chicken', name:'土豆炖鸡', category:'荤菜', kind:'meat', taste:'酱香 · 可选辣度', image:'', imageSource:'ai', base:2, ingredients:[{name:'鸡肉',qty:350,unit:'克'},{name:'土豆',qty:300,unit:'克'}] },
 { id:'cucumber', name:'拍黄瓜', category:'素菜', kind:'veg', taste:'清爽 · 蒜香', image:'', imageSource:'ai', base:2, ingredients:[{name:'黄瓜',qty:300,unit:'克'},{name:'大蒜',qty:10,unit:'克'}] }
 ,{id:'pepper-pork',name:'青椒肉丝',category:'荤菜',kind:'meat',taste:'鲜香 · 可选辣度',image:'',imageSource:'ai',base:2,ingredients:[{name:'猪肉',qty:300,unit:'克'},{name:'青椒',qty:200,unit:'克'}]},
 {id:'braised-pork',name:'红烧肉',category:'荤菜',kind:'meat',taste:'酱香 · 软糯',image:'',imageSource:'ai',base:2,ingredients:[{name:'五花肉',qty:400,unit:'克'}]}
 ], members:[], plans:{}, supplies:{}, feedback:[], example:true }; }
function member(s, uid) { const m = s.members.find(x=>x.id === uid); if(!m) throw Error('仅家庭成员可访问'); return m; }
function cook(s, uid) { const m=member(s,uid); if(m.role !== 'cook') throw Error('仅做饭者可修改'); return m; }
function ingredientKey(name, unit) { return `${text(name,40)}|${unit}`; }
const units=['克','千克','个','毫升','升'];
function normalize(i) { let qty=num(i.qty), unit=i.unit; if(!units.includes(unit)) throw Error('不支持的单位'); if(unit==='千克'){qty*=1000;unit='克';} if(unit==='升'){qty*=1000;unit='毫升';} return {name:text(i.name,40),qty,unit}; }
function recipe(input) { const r=clone(input); r.id=text(r.id,80);r.name=text(r.name,40);r.category=text(r.category||'家常',20); if(!r.id||!r.name)throw Error('请填写菜名');r.base=num(r.base,0.1,10);if(!Array.isArray(r.ingredients)||r.ingredients.length>50)throw Error('食材格式错误');r.ingredients=r.ingredients.map(i=>{const n=normalize(i);if(!n.name||!n.qty)throw Error('请填写食材和分量');return n;});r.image=text(r.image||'',1000);if(!['ai','user','none'].includes(r.imageSource))throw Error('图片来源错误');return r; }
function shopping(s, p, supplies = s.supplies) { const out={items:[],missingRecipes:[],missingPrices:0,total:0}; if(!p)return out;const sums={};const eaters=p.eaters||s.members.reduce((a,m)=>a+Number(m.appetite||1),0)||2;
 for(const line of p.lines){ const r=p.recipes ? p.recipes.find(x=>x.id===line.id):s.recipes.find(x=>x.id===line.id);if(!r||!r.ingredients.length){out.missingRecipes.push(r?r.name:line.id);continue;} for(const raw of r.ingredients){const i=normalize(raw),key=ingredientKey(i.name,i.unit);if(!sums[key])sums[key]={key,name:i.name,unit:i.unit,need:0};sums[key].need+=i.qty*line.count*(line.servings||1)*eaters/r.base;}}
 for(const x of Object.values(sums)){const cfg=supplies[x.key]||{};x.need=round(x.need);x.stock=num(cfg.stock==null?0:cfg.stock);x.packageSize=num(cfg.packageSize==null?0:cfg.packageSize);const remaining=Math.max(0,x.need-x.stock);x.buy=round(x.packageSize?Math.ceil(remaining/x.packageSize)*x.packageSize:remaining);x.price=cfg.price==null?null:num(cfg.price);x.priceUnit=num(cfg.priceUnit==null?1:cfg.priceUnit,0.0001);x.updatedAt=cfg.updatedAt||'';x.cost=x.buy===0?0:x.price==null?null:round(x.buy*x.price/x.priceUnit);if(x.cost==null)out.missingPrices++;else out.total+=x.cost;x.checked=!!(p.checked||{})[x.key];out.items.push(x);}out.total=round(out.total);return out; }
function apply(s, uid, action, data={}, now=Date.now()) { const n=clone(s); const m=member(n,uid); const w=data.week && validateWeek(data.week);
 switch(action){
 case 'saveRecipe': cook(n,uid);{const r=recipe(data.recipe);const i=n.recipes.findIndex(x=>x.id===r.id);if(i<0)n.recipes.push(r);else n.recipes[i]=r;}break;
 case 'submit': {const old=n.plans[w];const requestId=text(data.requestId,100);if(!requestId)throw Error('缺少提交标识');if(old&&old.requestId===requestId)return n;if(!Array.isArray(data.lines)||data.lines.length>100)throw Error('菜单格式错误');const seen=new Set();const lines=data.lines.map(l=>{if(!n.recipes.some(r=>r.id===l.id)||seen.has(l.id))throw Error('菜品不存在或重复');seen.add(l.id);const count=num(l.count,1,21);if(!Number.isInteger(count))throw Error('次数须为整数');const servings=num(l.servings==null?1:l.servings,1,6);if(!Number.isInteger(servings))throw Error('份数须为整数');const spice=l.spice||'不辣';if(!['不辣','辣'].includes(spice))throw Error('口味格式错误');return {id:l.id,count,servings,spice,note:text(l.note||'',200)};});const extra=text(data.extra||'',500);if(!lines.length&&!extra)throw Error('先选一道菜吧');if(old&&Number(data.expectedVersion)!==old.version)throw Error('菜单已更新，请刷新后再提交');n.plans[w]={week:w,lines,extra,version:(old?old.version:0)+1,requestId,submittedAt:now,submittedBy:uid,confirmedAt:null,confirmedVersion:null,recipes:clone(n.recipes.filter(r=>seen.has(r.id))),eaters:n.members.reduce((a,x)=>a+x.appetite,0),supplies:clone(n.supplies),checked:{},notification:'待发送'};break;}
 case 'confirm': cook(n,uid);{const p=n.plans[w];if(!p||p.version!==Number(data.version))throw Error('菜单已更新，请先刷新');p.confirmedAt=now;p.confirmedVersion=p.version;}break;
 case 'supply': cook(n,uid);{const key=text(data.key,80);if(!key.includes('|'))throw Error('食材格式错误');n.supplies[key]={stock:num(data.stock),price:data.price===''||data.price==null?null:num(data.price),priceUnit:num(data.priceUnit,0.0001),packageSize:num(data.packageSize),updatedAt:now};}break;
 case 'check': cook(n,uid);{const p=n.plans[w];if(!p||p.version!==Number(data.version))throw Error('菜单已更新，请刷新');p.checked[text(data.key,80)]=!!data.checked;}break;
 case 'favorite': {const id=text(data.id,80);if(!n.recipes.some(r=>r.id===id))throw Error('菜品不存在');m.favorites=m.favorites||[];if(m.favorites.includes(id))m.favorites=m.favorites.filter(x=>x!==id);else m.favorites.push(id);}break;
 case 'appetite': {const a=num(data.value,0.25,3);m.appetite=a;}break;
 case 'feedback': cook(n,uid);{if(!['够吃','剩多了','不够'].includes(data.result)||!n.recipes.some(r=>r.id===data.recipeId))throw Error('反馈格式错误');n.feedback.push({recipeId:data.recipeId,result:data.result,note:text(data.note||'',200),at:now});if(n.feedback.length>300)n.feedback.shift();}break;
 default:throw Error('未知操作');
 }return n; }
function coverage(recipes,lines){const out={meatMeals:0,vegMeals:0,meatKinds:0,vegKinds:0,target:9};for(const l of lines){const r=recipes.find(x=>x.id===l.id);if(!r||!l.count)continue;const kind=r.kind||(r.category==='荤菜'?'meat':'veg');out[kind+'Meals']+=Number(l.count);out[kind+'Kinds']++;}return out;}
module.exports={coverage,clone,round,num,text,weekKey,validateWeek,seed,member,cook,recipe,shopping,apply,ingredientKey,normalize};
