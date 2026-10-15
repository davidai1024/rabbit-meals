const test=require('node:test'),assert=require('node:assert/strict');

function setup(t,role='guest',route='v3-menu',initialReady=true){
 let definition,page={route:'pages/'+route+'/index',data:{pageReady:initialReady}};
 const switches=[],updates=[];
 global.Component=value=>definition=value;
 global.wx={getStorageSync:()=>role,switchTab:options=>switches.push(options)};
 global.getCurrentPages=()=>[page];
 const path=require.resolve('../miniprogram/custom-tab-bar/index');
 delete require.cache[path];require(path);
 const bar={data:JSON.parse(JSON.stringify(definition.data)),...definition.methods,setData(patch){updates.push(patch);Object.assign(this.data,patch);}};
 t.after(()=>{delete require.cache[path];delete global.Component;delete global.wx;delete global.getCurrentPages;});
 return {bar,definition,switches,updates,route(value){page={route:'pages/'+value+'/index',data:{pageReady:true}};},modal(value){page.data.editing=value;},ready(value){page.data.pageReady=value;}};
}
function tap(bar,page){bar.go({currentTarget:{dataset:{page}}});}
test('导航初始隐藏，冷启动准备与错误阶段均不显示，ready后直接恢复',t=>{
 const {bar,definition,ready}=setup(t,'guest','v3-menu',false);assert.equal(bar.data.hidden,true);ready(false);definition.lifetimes.attached.call(bar);assert.equal(bar.data.hidden,true);bar.sync();assert.equal(bar.data.hidden,true);
 ready(true);bar.sync();assert.equal(bar.data.hidden,false);assert.equal(bar.data.selected,'v3-menu');ready(false);bar.sync();assert.equal(bar.data.hidden,true);
});
test('已有ready的暖页面构造导航即显示，attached不先隐藏再恢复',t=>{
 const {bar,definition,updates}=setup(t,'guest','v3-week');assert.equal(bar.data.hidden,false);assert.equal(bar.data.selected,'v3-week');definition.lifetimes.attached.call(bar);assert.equal(updates.length,0);assert.equal(bar.data.hidden,false);
});

test('导航状态不变不重绘，切换页只更新选中位置，弹层隐藏仍保持项目',t=>{
 const {bar,updates,route,modal}=setup(t);
 bar.sync();updates.length=0;bar.sync();assert.equal(updates.length,0);
 route('v3-week');bar.sync();assert.equal(bar.data.selectedIndex,1);assert.equal(updates.length,1);assert.equal(updates[0].items,undefined);
 modal({form:'basket'});bar.sync();assert.equal(bar.data.hidden,true);assert.equal(bar.data.items.length,3);
 modal(null);bar.sync();assert.equal(bar.data.hidden,false);
});

for(const example of [{role:'guest',page:'v3-stats',index:2},{role:'cook',page:'v3-shopping',index:1}]){
 test(example.role+'身份首次进入非首项，选中状态直接就位且不播放入场过渡',t=>{
  const {bar,definition}=setup(t,example.role,example.page);
  assert.equal(bar.data.selected,example.page);assert.equal(bar.data.selectedIndex,example.index);
  definition.lifetimes.attached.call(bar);definition.pageLifetimes.show.call(bar);
  assert.equal(bar.data.selectedIndex,example.index);
 });
}

test('复用组件定义进入新页面及返回缓存页均直接恢复，不从首项播放动画',t=>{
 const {bar,definition,route}=setup(t);
 // A component definition may have been registered while another tab was active.
 route('v3-stats');definition.lifetimes.attached.call(bar);
 assert.equal(bar.data.selected,'v3-stats');assert.equal(bar.data.selectedIndex,2);
 tap(bar,'v3-week');assert.equal(bar.data.selected,'v3-stats');
 route('v3-stats');definition.pageLifetimes.show.call(bar);
 assert.equal(bar.data.selected,'v3-stats');assert.equal(bar.data.selectedIndex,2);
});

test('点击立即切页且互斥，当前项和重复点击不再发起导航',t=>{
 const {bar,switches,route,updates}=setup(t);
 tap(bar,'v3-menu');assert.equal(switches.length,0);
 tap(bar,'v3-stats');assert.equal(switches.length,1);assert.equal(switches[0].url,'/pages/v3-stats/index');
 // Before navigation commits, the highlight must still match the visible content.
 assert.equal(bar.data.selected,'v3-menu');assert.equal(bar.data.selectedIndex,0);assert.equal(updates.length,0);
 tap(bar,'v3-stats');tap(bar,'v3-week');assert.equal(switches.length,1);
 route('v3-stats');switches[0].complete();bar.sync();assert.equal(bar.data.selected,'v3-stats');assert.equal(bar.data.selectedIndex,2);
 tap(bar,'v3-week');assert.equal(switches.length,2);assert.equal(bar.data.selected,'v3-stats');
});

test('切页失败恢复当前路由和图标，后续点击可正常重试',t=>{
 const {bar,switches}=setup(t);
 tap(bar,'v3-week');switches[0].fail();switches[0].complete();
 assert.equal(bar.data.selected,'v3-menu');assert.equal(bar.data.selectedIndex,0);
 tap(bar,'v3-week');assert.equal(switches.length,2);
});

test('组件销毁后迟到的导航失败回调不再重绘',t=>{
 const {bar,definition,switches,updates}=setup(t);
 tap(bar,'v3-week');definition.lifetimes.detached.call(bar);updates.length=0;
 switches[0].fail();switches[0].complete();assert.equal(updates.length,0);assert.equal(bar._navigating,false);
});
