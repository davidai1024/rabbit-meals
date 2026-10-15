'use strict';
const crypto=require('crypto');const d=require('./domain');
function createHandler(cloud, env=process.env) {
 const db=cloud.database();const families=db.collection('families');const identities=db.collection('identities');
 const attempt=async(p)=>{try{return (await p).data;}catch(e){if(e.errCode===-1||/not exist|not found|不存在/i.test(e.message||''))return null;throw e;}};
 async function notify(fid,week,version) {
  let plan, cookId, claimed=false;
  await db.runTransaction(async t=>{const doc=t.collection('families').doc(fid);const f=(await doc.get()).data;plan=f.state.plans[week];if(!plan||plan.version!==version||plan.notification!=='待发送')return;claimed=true;cookId=f.state.members.find(m=>m.role==='cook').id;plan.notification='发送处理中';await doc.update({data:{state:f.state}});});
  if(!claimed)return;
  let status='未配置微信提醒';
  if(env.MENU_TEMPLATE_ID&&env.MENU_TEMPLATE_MAPPING){
   try {const map=JSON.parse(env.MENU_TEMPLATE_MAPPING);const values={title:'下周菜单已提交',week,count:String(plan.lines.reduce((a,l)=>a+l.count,0)),time:new Date(plan.submittedAt).toISOString().replace('T',' ').slice(0,19),note:'打开小饭桌查看'};const data={};for(const [key,value] of Object.entries(map)){if(!Object.hasOwn(values,value))throw Error('模板映射错误');data[key]={value:values[value]};}
    const result=await cloud.openapi.subscribeMessage.send({touser:cookId,templateId:env.MENU_TEMPLATE_ID,page:`pages/week/index?week=${week}`,miniprogramState:env.MINIPROGRAM_STATE||'trial',lang:'zh_CN',data});
    status=result.errCode&&result.errCode!==0?'提醒发送失败':'微信已受理（不代表设备送达）';
   } catch(e){status=/43101/.test(String(e.errCode)||e.message)?'未订阅或授权已用完':'提醒发送失败，请在接单页检查订阅';}
  }
  await db.runTransaction(async t=>{const doc=t.collection('families').doc(fid);const f=(await doc.get()).data;const p=f.state.plans[week];if(p&&p.version===version){p.notification=status;await doc.update({data:{state:f.state}});}});
 }
 return async function handler(event={}) {try{
  const uid=cloud.getWXContext().OPENID;if(!uid)throw Error('无法获取微信身份');const action=event.action;
  let identity=await attempt(identities.doc(uid).get());
  if(action==='create') {
   if(identity)throw Error('已加入家庭，请刷新');const name=d.text(event.name||'做饭的人',30);const fid=crypto.randomBytes(16).toString('hex');const code=crypto.randomBytes(16).toString('hex');const state=d.seed();state.members=[{id:uid,name,role:'cook',appetite:1}];
   await db.runTransaction(async t=>{const i=t.collection('identities').doc(uid);if(await attempt(i.get()))throw Error('已加入家庭');await t.collection('families').doc(fid).set({data:{inviteCode:code,state,createdAt:Date.now()}});await i.set({data:{familyId:fid}});});identity={familyId:fid};
  } else if(action==='join') {
   if(identity)throw Error('已加入家庭，请刷新');const code=d.text(event.code||'',64);if(!/^[a-f0-9]{32}$/.test(code))throw Error('邀请码格式错误');const found=(await families.where({inviteCode:code}).limit(1).get()).data;if(!found.length)throw Error('邀请码不存在');const fid=found[0]._id;
   await db.runTransaction(async t=>{const i=t.collection('identities').doc(uid);if(await attempt(i.get()))throw Error('已加入家庭');const doc=t.collection('families').doc(fid),f=(await doc.get()).data;if(f.state.members.length>=2)throw Error('家庭已有两位成员');f.state.members.push({id:uid,name:d.text(event.name||'点菜的人',30),role:'guest',appetite:1});await doc.update({data:{state:f.state}});await i.set({data:{familyId:fid}});});identity={familyId:fid};
  }
  if(!identity)return {ok:true,unbound:true,uid};const fid=identity.familyId;
  if(action==='uploadImage'){const f=(await families.doc(fid).get()).data;d.cook(f.state,uid);const raw=event.data||{};if(typeof raw.base64!=='string'||raw.base64.length>700000)throw Error('照片压缩后请小于500KB');const buf=Buffer.from(raw.base64,'base64');const png=buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));const jpg=buf[0]===255&&buf[1]===216&&buf[2]===255;if(!png&&!jpg)throw Error('只支持PNG或JPEG照片');const upload=await cloud.uploadFile({cloudPath:`families/${fid}/${crypto.randomBytes(16).toString('hex')}.${png?'png':'jpg'}`,fileContent:buf});return {ok:true,fileID:upload.fileID};}
  if(!['get','create','join','imagePaths'].includes(action)) {
   await db.runTransaction(async t=>{const doc=t.collection('families').doc(fid),f=(await doc.get()).data;d.member(f.state,uid);if(action==='saveRecipe'){const r=event.data.recipe;d.cook(f.state,uid);if(r.image&&(!r.image.startsWith('cloud://')||!r.image.includes(`/families/${fid}/`)))throw Error('照片必须来自当前家庭空间');}
    const state=d.apply(f.state,uid,action,event.data||{});await doc.update({data:{state}});
   });
   if(action==='submit'){const f=(await families.doc(fid).get()).data;const p=f.state.plans[event.data.week];try{await notify(fid,event.data.week,p.version);}catch(e){/* 菜单已持久化，通知故障不回滚 */}}
  }
  const f=(await families.doc(fid).get()).data;const me=d.member(f.state,uid);const output=d.clone(f.state);
  if(event.action==='imagePaths'){d.cook(f.state,uid);return {ok:true,familyId:fid,uid};}
  for(const r of output.recipes){if(r.image){if(!r.image.startsWith('cloud://')||!r.image.includes(`/families/${fid}/`)){r.image='';continue;}try{const v=await cloud.getTempFileURL({fileList:[r.image]});r.displayImage=v.fileList[0].tempFileURL;}catch(e){r.displayImage='';}}}
  // 身份标识不返回另一位家庭成员的openid。
  for(const plan of Object.values(output.plans)){plan.submittedBy=plan.submittedBy===uid?uid:'partner';}
  output.members=output.members.map(x=>({...x,id:x.id===uid?uid:'partner'}));
  return {ok:true,state:output,uid,familyId:fid,role:me.role,inviteCode:me.role==='cook'&&f.state.members.length<2?f.inviteCode:null};
 } catch(e){return {ok:false,error:e.message||'操作失败，请重试'};}};
}
module.exports={createHandler};
