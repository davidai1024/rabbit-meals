const test=require('node:test'),a=require('node:assert/strict');
const nav=require('../miniprogram/utils/role-navigation'),m=require('../miniprogram/utils/planning'),pages=require('../miniprogram/utils/planning-pages');
test('身份导航：点餐三项、大厨四项，默认页与受限入口正确',()=>{
 a.deepEqual(nav.tabs('guest').map(x=>x.label),['点菜','已点','统计']);
 a.deepEqual(nav.tabs('cook').map(x=>x.label),['做饭','买菜','统计','菜品库']);
 a.equal(nav.start('cook'),'v3-week');a.equal(nav.start('guest'),'v3-menu');
 a.equal(nav.resolve('cook','v3-menu'),'v3-week');
 for(const page of ['v3-shopping','v3-home','v3-recipe'])a.equal(nav.resolve('guest',page),'v3-menu');
});
test('统计：库总数含隐藏，菜种去重，同菜跨计划累加，反馈不冒充制作',()=>{
 const s=m.initial();const [x,y]=s.recipes;s.recipes[0].hidden=true;
 s.plans={a:{lines:[{id:x.id,tasks:{cook:true}},{id:x.id,tasks:{cook:true}},{id:y.id,tasks:{cook:false}}]},b:{lines:[{id:x.id,tasks:{cook:true}},{id:y.id,tasks:{cook:true}}]}};
 s.records=[{recipeId:x.id,again:true},{recipeId:x.id,again:true}];
 const out=m.stats(s);a.equal(out.libraryCount,s.recipes.length);a.equal(out.availableCount,s.recipes.length-1);a.equal(out.cooked,3);a.equal(out.cookedKinds,2);a.equal(out.mostCooked[0].id,x.id);a.equal(out.mostCooked[0].count,2);a.equal(out.again,2);a.equal(out.feedback,2);
 s.plans.a.lines[0].cancelled=true;s.plans.a.lines[1].cancelled=true;a.equal(m.stats(s).cooked,2);
});
test('统计空态：不编造排行',()=>{
 const s={recipes:[],plans:{},records:[]};const out=m.stats(s);
 a.equal(out.libraryCount,0);a.equal(out.cookedKinds,0);a.equal(out.cooked,0);a.deepEqual(out.mostCooked,[]);
});
test('双餐单同时展示、独立进入，旧周期偏移不生效',()=>{
 const state=m.initial(),period=m.period();state.plans[m.planKey('next',period)]={...m.getPlan(state,'next',period),status:'submitted',lines:[{id:state.recipes[0].id,multiplier:1}]};
 const store={'rabbit-meals-local-v3':state,'rabbit-meals-role':'cook','rabbit-meals-offset':7,'rabbit-meals-type':'next'};
 global.wx={getStorageSync:k=>store[k],setStorageSync:(k,v)=>store[k]=v,switchTab:()=>{}};
 const def=pages.week(),p={...def,data:JSON.parse(JSON.stringify(def.data)),setData(v){Object.assign(this.data,v);}};p.onShow();
 a.equal(p.data.view,'overview');a.equal(p.data.offset,0);a.equal(p.data.period.week,period.week);a.equal(p.data.currentOrders.length,1);a.equal(p.data.currentOrders[0].count,1);a.equal(p.data.pastOrders.length,0);
 p.openPlan({currentTarget:{dataset:{type:'next',key:m.planKey('next',period)}}});a.equal(p.data.view,'menu');a.equal(p.data.type,'next');a.equal(p.data.lines.length,1);p.overview();a.equal(p.data.currentOrders[0].count,1);
});
