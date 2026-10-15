const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const copy=x=>JSON.parse(JSON.stringify(x)),tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(cached=null){
 let definition,info=cached;const requests=[];
 const service={info:()=>info,role:()=>info?.role||'',testResetStatus:()=>({}),notificationPreferenceStatus:()=>({}),sync:()=>new Promise((resolve,reject)=>requests.push({resolve:value=>{info=value;resolve(value);},reject})),run(){throw Error('Initial page retry must not use the ordinary-write busy wrapper');}};
 vm.runInNewContext(fs.readFileSync('miniprogram/pages/pair/index.js','utf8'),{Page:value=>definition=value,wx:{},require:name=>name.endsWith('planning-service')?service:name.endsWith('config')?{notificationTemplates:[],testToolsEnabled:false}:require('../miniprogram/utils/role-navigation')});
 const frames=[],page={...definition,data:copy(definition.data),setData(value){Object.assign(this.data,value);frames.push(copy(this.data));}};return {page,requests,frames};
}
test('真实unbound返回前绑定页不ready，返回后才展示创建加入入口',async()=>{
 const x=fixture();x.page.onLoad();const loading=x.page.onShow();await tick();assert.equal(x.page.data.pageReady,false);assert.equal(x.page.data.pageLoading,true);assert.equal(x.page.data.busy,false);assert.equal(x.requests.length,1);
 x.requests[0].resolve({ok:true,unbound:true});await loading;assert.equal(x.page.data.pageReady,true);assert.equal(x.page.data.pageLoading,false);assert.equal(x.page.data.pageLoadError,'');assert.equal(x.page.data.unbound,true);
});
test('设置首屏失败只有连接错误，重试独立于普通busy且不会重复发请求',async()=>{
 const x=fixture(),first=x.page.onShow();await tick();x.requests[0].reject(Error('Internal cloud environment-id and account details'));await first;
 assert.equal(x.page.data.pageReady,false);assert.equal(x.page.data.pageLoading,false);assert.equal(x.page.data.pageLoadError,'暂时连接不上，请检查网络后再试。');assert.equal(x.page.data.error,'');x.page.data.busy=true;
 const retry=x.page.retryPageLoad(),duplicate=x.page.retryPageLoad();assert.equal(retry,duplicate);await tick();assert.equal(x.requests.length,2);assert.equal(x.page.data.pageLoading,true);assert.equal(x.page.data.pageLoadError,'');
 x.requests[1].resolve({ok:true,unbound:false,role:'guest',members:2,code:'current-family'});await retry;assert.equal(x.page.data.pageReady,true);assert.equal(x.page.data.unbound,false);assert.equal(x.page.data.members,2);assert.equal(x.page.data.invite,'current-family');assert.equal(x.page.data.pageLoadError,'');
});
test('已有会话设置缓存onLoad即可ready，后台刷新慢或失败都保留可用内容',async()=>{
 const x=fixture({ok:true,unbound:false,role:'cook',members:2,code:'cached-family'});x.page.onLoad();assert.equal(x.page.data.pageReady,true);assert.equal(x.page.data.invite,'cached-family');x.frames.length=0;
 const refresh=x.page.onShow();await tick();assert.equal(x.page.data.pageReady,true);assert.equal(x.page.data.pageLoading,false);x.requests[0].reject(Error('network'));await refresh;
 assert.equal(x.page.data.pageReady,true);assert.equal(x.page.data.invite,'cached-family');assert.equal(x.page.data.pageLoadError,'');assert.ok(x.frames.every(frame=>frame.pageReady));
});
