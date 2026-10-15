const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../miniprogram/utils/planning'),service=require('../miniprogram/utils/planning-service'),pages=require('../miniprogram/utils/planning-pages');
test('大厨一键买好更新进度并只提示一次，空待买清单不会重复操作',()=>{
 const store={},toasts=[];global.wx={getStorageSync:key=>store[key],setStorageSync:(key,value)=>store[key]=JSON.parse(JSON.stringify(value)),showToast:o=>toasts.push(o)};
 service.setRole('cook');const state=service.state(),period=model.period(),r=state.recipes.find(r=>!r.hidden&&model.complete(r)),plan=model.getPlan(state,'next',period);
 state.plans[plan.key]={...plan,status:'confirmed',recipes:[r],lines:[{id:r.id,multiplier:1}]};wx.setStorageSync(service.KEY,state);
 const def=pages.shopping(),page={...def,data:JSON.parse(JSON.stringify(def.data)),setData(value){Object.assign(this.data,value)}};page.load();assert.ok(page.data.shoppingTotal>0);assert.equal(page.data.shoppingDone,0);
 page.buyAll();assert.equal(page.data.shoppingDone,page.data.shoppingTotal);assert.ok(page.data.items.every(i=>i.purchaseState==='bought'));assert.equal(page.data.busy,false);assert.equal(toasts.length,1);
 const saved=JSON.stringify(service.state());page.buyAll();assert.equal(JSON.stringify(service.state()),saved);assert.equal(toasts.length,1);
 delete global.wx;
});
