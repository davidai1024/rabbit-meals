const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const c=require('../miniprogram/utils/recipe-catalog'),migration=require('../miniprogram/utils/catalog-migration'),m=require('../miniprogram/utils/planning'),service=require('../miniprogram/utils/planning-service');
test('开源演示8道为4荤4素，文字与SVG均本地可编辑，不含第三方图文来源',()=>{
 a.equal(c.recipes.length,8);a.equal(new Set(c.recipes.map(r=>r.id)).size,8);a.equal(c.recipes.filter(r=>r.kind==='meat').length,4);a.equal(c.recipes.filter(r=>r.kind==='veg').length,4);
 for(const r of c.recipes){
  a.equal(r.meals,3);a.equal(r.purchaseVerified,false);a.ok(m.complete(r));a.ok(r.tasteTags.length);a.ok(r.method.length>10);a.equal(r.imageSource,'demo');a.match(r.image,/^\/assets\/demo-[a-z-]+\.svg$/);
  const svg=fs.readFileSync(path.join(__dirname,'../miniprogram',r.image),'utf8');a.match(svg,/<svg\b/);a.doesNotMatch(svg,/<image\b|https?:\/\/(?!www\.w3\.org)/);
  for(const key of ['sourceAuthor','sourceUrl','imageSourceUrl','imageCredit'])a.equal(r[key],undefined);
  for(const i of r.ingredients){a.ok(i.qty>0);a.ok(m.ingredient(i));}
 }
});
test('更换demo库不改变原菜单配方采购、记录、账本、收藏，保留旧示例备份',()=>{
 let old=m.initial();old.recipes.forEach(r=>r.purchaseVerified=true);const p=m.period(),lines=old.recipes.map(r=>({id:r.id,multiplier:1}));old=m.apply(old,'guest','submit',{period:p,type:'next',lines});old.plans[Object.keys(old.plans)[0]].recipes=undefined;old.favorites.guest=['cucumber','tomato-egg'];old.recipes.push({id:'personal',name:'自家菜',ingredients:[],hidden:false});
 const snapshot=JSON.stringify(old),before=m.shopping(old,p),next=migration.migrate(old);a.equal(JSON.stringify(old),snapshot);a.deepEqual(m.shopping(next,p),before);a.deepEqual(next.ledger,old.ledger);a.deepEqual(next.favorites,old.favorites);a.deepEqual(next.records,old.records);
 a.ok(next.recipes.find(r=>r.id==='personal'));a.equal(next.recipes.filter(r=>!r.archived).length,9);a.equal(next.catalogArchive.length,6);a.equal(next.recipes.find(r=>r.id==='cucumber').name,'蒜香黄瓜');a.ok(next.plans[Object.keys(next.plans)[0]].recipes.length);
});
test('重复加载不覆盖个人编辑，迁移前持久备份仅一次',()=>{const mem=new Map(),old=m.initial();mem.set(service.KEY,old);global.wx={getStorageSync:k=>mem.get(k),setStorageSync:(k,v)=>mem.set(k,JSON.parse(JSON.stringify(v)))};let next=service.state();const key=service.KEY+'-before-'+c.version;a.deepEqual(mem.get(key),old);next.recipes[0].ingredients[0].qty=999;mem.set(service.KEY,next);a.equal(service.state().recipes[0].ingredients[0].qty,999);a.deepEqual(mem.get(key),old);a.equal(migration.migrate(next),next);});
test('demo点满3荤3素，采购按配方总量汇总，不额外乘3或2',()=>{
 let s=migration.migrate(m.initial());const p=m.period(),ids=['potato-chicken','pepper-pork','braised-pork','tomato-egg','broccoli','cucumber'];s=m.apply(s,'guest','selectDraft',{period:p,type:'next',lines:ids.map(id=>({id,multiplier:1}))});s=m.apply(s,'guest','submitMenu',{period:p,type:'next'});
 a.ok(m.getPlan(s,'next',p).lines.every(l=>l.portions===3&&l.multiplier===1));const rows=m.shopping(s,p).items;a.equal(rows.find(x=>x.name==='鸡腿肉').need,450);a.equal(rows.find(x=>x.name==='猪肉').need,300);a.equal(rows.find(x=>x.name==='大蒜').need,25);s=m.apply(s,'cook','confirm',{period:p,type:'next'});a.equal(m.getPlan(s,'next',p).status,'confirmed');
});
test('空白安装可选8道且每类都有替换选择，客户端与云端catalog一致',()=>{
 const s=migration.migrate(m.initial());a.equal(s.recipes.filter(r=>!r.hidden).length,8);a.equal(m.stats(s).libraryCount,8);a.equal(m.stats(s).availableCount,8);a.deepEqual(c,require('../cloudfunctions/planningFamily/recipe-catalog'));
 for(const kind of ['meat','veg'])a.equal(s.recipes.filter(r=>r.kind===kind&&!r.hidden).slice(3).length,1);
});
