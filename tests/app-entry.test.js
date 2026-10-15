const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const copy=x=>JSON.parse(JSON.stringify(x)),root=path.join(__dirname,'../miniprogram');
function loadApp(config={env:'test-env'},cloudEnabled=true){
 const navigation=[],initializations=[],stored=new Map([['family',{role:'cook',members:2}],['usage',{plans:{draft:[]}}]]);let app;
 const wx={switchTab:options=>navigation.push(copy(options)),getStorageSync:key=>stored.get(key),setStorageSync(){throw Error('入口恢复不应写入数据');},removeStorageSync(){throw Error('入口恢复不应删除数据');},clearStorageSync(){throw Error('入口恢复不应清空数据');}};
 if(cloudEnabled)wx.cloud={init:options=>initializations.push(copy(options)),callFunction(){throw Error('入口恢复不应调用云端修改数据');}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),{wx,App:definition=>app=definition,require:name=>{if(name==='./utils/notification-entry')return require('../miniprogram/utils/notification-entry');assert.equal(name,'./utils/config');return config;}});
 return {app,navigation,initializations,stored};
}
test('正常启动保留原有云环境初始化，不额外跳转',()=>{
 const c=loadApp();c.app.onLaunch({path:'pages/v3-menu/index',query:{}});
 assert.deepEqual(c.initializations,[{env:'test-env',traceUser:true}]);assert.deepEqual(c.navigation,[]);
});
test('未配置云环境或基础库没有云能力时仍可正常启动',()=>{
 for(const c of [loadApp({env:''}),loadApp({env:'test-env'},false)]){c.app.onLaunch();assert.deepEqual(c.initializations,[]);assert.deepEqual(c.navigation,[]);}
});
test('旧二维码和未知扫码页面都恢复到实际注册的首页 tab',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));
 for(const missing of ['pages/menu/index','pages/week/index','pages/home/index','pages/does-not-exist/index']){
  const c=loadApp();c.app.onPageNotFound({path:missing,query:{week:'2026-10-19'},isEntryPage:true});
  assert.deepEqual(c.navigation,[{url:'/pages/v3-menu/index'}]);
  const target=c.navigation[0].url.slice(1);assert.ok(manifest.pages.includes(target));assert.ok(manifest.tabBar.list.some(tab=>tab.pagePath===target));
 }
});
test('入口恢复不透传原路径或查询参数，保留家庭和使用记录',()=>{
 const c=loadApp(),before=copy([...c.stored]);
 c.app.onPageNotFound({path:'pages/removed/index?redirect=other',query:{redirect:'pages/removed/index',clearData:'true',scene:'old-code'},isEntryPage:true});
 assert.deepEqual(c.navigation,[{url:'/pages/v3-menu/index'}]);assert.deepEqual([...c.stored],before);assert.deepEqual(c.initializations,[]);
});
