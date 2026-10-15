const test=require('node:test'),a=require('node:assert/strict');
const m=require('../miniprogram/utils/planning'),pages=require('../miniprogram/utils/planning-pages'),s=require('../miniprogram/utils/planning-service');
const store=new Map();global.wx={getStorageSync:k=>store.get(k),setStorageSync:(k,v)=>store.set(k,JSON.parse(JSON.stringify(v))),showToast:()=>{},navigateBack:()=>{}};
const event=value=>({currentTarget:{dataset:{value}}});
function page(options={}){const def=pages.recipe(),p={...def,data:JSON.parse(JSON.stringify(def.data)),setData(v){Object.assign(this.data,v);}};p.onLoad(options);return p;}
test('新菜默认3顿，口味多选可取消并保存重开，无旧必填字段',()=>{
 store.clear();s.setRole('cook');let p=page();a.equal(p.data.r.meals,3);for(const key of ['minutes','method','freeze','standard'])a.equal(p.data.r[key],undefined);
 p.rtaste(event('鲜香'));p.rtaste(event('清淡'));p.rtaste(event('清淡'));a.deepEqual(p.data.r.tasteTags,['鲜香']);p.data.r.name='表单测试菜';const id=p.data.r.id;p.save();a.equal(p.data.error,'');p=page({id});a.equal(p.data.r.meals,3);a.equal(p.data.r.taste,'鲜香');a.ok(p.data.tasteOptions.find(t=>t.label==='鲜香').selected);
});
test('旧菜编辑默认3顿而不是原人数，保留旧口味及人数，已提交采购不漂移',()=>{
 store.clear();s.setRole('cook');let st=m.initial();st.catalogVersion=require('../miniprogram/utils/recipe-catalog').version;st.recipes[0]={...st.recipes[0],standard:7,base:7,taste:'家常鲜香',purchaseVerified:true};const id=st.recipes[0].id,period=m.period();st=m.apply(st,'guest','submit',{period,type:'weekend',lines:[{id,multiplier:2,day:period.sat,meal:'午餐',people:2}]});store.set('rabbit-meals-local-v3',st);const before=m.shopping(st,period),original=JSON.stringify(st.recipes[0]);let p=page({id});a.equal(p.data.r.meals,3);a.equal(p.data.legacyMeals,true);a.ok(p.data.tasteOptions.find(t=>t.label==='家常鲜香').selected);a.equal(JSON.stringify(s.state().recipes[0]),original);p.data.r.meals=5;p.save();const after=s.state(),r=after.recipes[0];a.equal(r.meals,5);a.equal(r.standard,7);a.equal(r.base,7);a.deepEqual(r.ingredients,st.recipes[0].ingredients.map(m.ingredient));a.deepEqual(m.shopping(after,period),before);a.deepEqual(after.plans,st.plans);
});
test('饭顿数验证：拒绝空、零、小数和超范围，缺省3顿不要求耗时',()=>{
 const state=m.initial(),r={id:'new',name:'新菜',kind:'veg',ingredients:[]};a.equal(m.apply(state,'cook','recipe',{recipe:r}).recipes.at(-1).meals,3);for(const meals of ['',0,-1,1.5,21,'abc'])a.throws(()=>m.apply(state,'cook','recipe',{recipe:{...r,meals}}));
});
test('无适宜性字段、待确认及旧不适合标记均不阻断冷冻，不迁移确认步骤',()=>{
 for(const freeze of [undefined,'待大厨确认','不适合冷冻']){let st=m.initial();st.recipes.forEach(r=>{r.purchaseVerified=true;if(freeze===undefined)delete r.freeze;else r.freeze=freeze;});const period=m.period(),lines=st.recipes.slice(0,6).map(r=>({id:r.id,multiplier:1}));const apply=(role,action,data={})=>st=m.apply(st,role,action,{period,type:'next',...data});apply('guest','submit',{lines});apply('cook','confirm');const id=lines[0].id;apply('cook','storage',{id,storage:'冷冻',eatDate:period.week,reheat:'蒸热',actualMultiplier:1});for(const task of ['cook','portion','freeze'])apply('cook','task',{id,task,checked:true});a.equal(m.getPlan(st,'next',period).lines[0].tasks.freeze,true);apply('cook','task',{id,task:'freeze',checked:false});a.equal(m.getPlan(st,'next',period).lines[0].tasks.freeze,false);}
});
test('新配方采购仍为食材总量乘倍数，不额外乘饭顿数',()=>{
 let st=m.initial();st=m.apply(st,'cook','recipe',{recipe:{id:'meal-test',name:'豆角',kind:'veg',meals:3,ingredients:[{name:'豆角',qty:600,unit:'克'}],purchaseVerified:true}});const period=m.period();st=m.apply(st,'guest','submit',{period,type:'weekend',lines:[{id:'meal-test',multiplier:2,day:period.sat,meal:'午餐',people:2}]});a.equal(m.shopping(st,period).items[0].need,1200);
});
