const {test}=require('node:test');const a=require('node:assert/strict');const {createHandler}=require('../cloudfunctions/family/handler');
function mock(){
 const store={families:{},identities:{}};let uid='a';
 const collection=n=>({
  doc:id=>({get:async()=>{if(!store[n][id])throw Error('not exist');return {data:JSON.parse(JSON.stringify(store[n][id]))};},set:async({data})=>{store[n][id]=JSON.parse(JSON.stringify(data));},update:async({data})=>{Object.assign(store[n][id],JSON.parse(JSON.stringify(data)));}}),
  where:q=>({limit:()=>({get:async()=>({data:Object.entries(store[n]).filter(([,v])=>v.inviteCode===q.inviteCode).map(([k,v])=>({...v,_id:k}))})})})
 });
 const db={collection,runTransaction:async fn=>fn({collection})};
 const cloud={database:()=>db,getWXContext:()=>({OPENID:uid}),getTempFileURL:async()=>({fileList:[]}),openapi:{subscribeMessage:{send:async()=>{throw Object.assign(Error('43101'),{errCode:43101});}}}};
 return {store,cloud,as:x=>uid=x};
}
test('创建加入共享、第三人拒绝、访客不能编辑、提醒失败不丢菜单',async()=>{const m=mock(),h=createHandler(m.cloud,{});let r=await h({action:'get'});a.equal(r.unbound,true);r=await h({action:'create'});a.equal(r.role,'cook');const code=r.inviteCode;m.as('b');r=await h({action:'join',code});a.equal(r.state.members.length,2);a.equal(r.role,'guest');a.equal(r.state.members[0].id,'partner');r=await h({action:'supply',data:{}});a.equal(r.ok,false);r=await h({action:'submit',data:{week:'2026-10-12',lines:[{id:'broccoli',count:1}],requestId:'r1'}});a.equal(r.ok,true);a.equal(r.state.plans['2026-10-12'].notification,'未配置微信提醒');m.as('c');a.equal((await h({action:'join',code})).ok,false);m.as('a');r=await h({action:'confirm',data:{week:'2026-10-12',version:1}});a.equal(r.ok,true);a.equal(r.state.plans['2026-10-12'].confirmedVersion,1);});
test('云函数拒绝跨家庭照片、通知无授权不丢单',async()=>{const m=mock(),h=createHandler(m.cloud,{MENU_TEMPLATE_ID:'x',MENU_TEMPLATE_MAPPING:'{"thing1":"title"}'});let r=await h({action:'create'});const recipe=r.state.recipes[0];recipe.image='cloud://env/families/other/photo.png';a.equal((await h({action:'saveRecipe',data:{recipe}})).ok,false);r=await h({action:'submit',data:{week:'2026-10-12',lines:[{id:'broccoli',count:1}],requestId:'a'}});a.equal(r.ok,true);a.equal(r.state.plans['2026-10-12'].notification,'未订阅或授权已用完');});
