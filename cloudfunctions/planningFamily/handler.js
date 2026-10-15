'use strict';
const crypto=require('crypto'),model=require('./planning'),catalog=require('./catalog-migration'),defaultTestTools=require('./test-tools'),notificationsModule=require('./notifications');
const copy=value=>JSON.parse(JSON.stringify(value));
const retainedStateKeys=new Set(['schema','recipes','catalogVersion','catalogArchive']);
function usageValue(value){if(Array.isArray(value))return value.length>0;if(value&&typeof value==='object')return Object.values(value).some(usageValue);return value!==undefined&&value!==null&&value!==false&&value!==0&&value!=='';}
function hasUsage(state){return Object.entries(state).some(([key,value])=>!retainedStateKeys.has(key)&&usageValue(value));}
function rejectReset(message){const error=Error(message);error.code='TEST_RESET_REJECTED';throw error;}
function resetUsage(state){
 const clean={schema:state.schema||3,recipes:copy(state.recipes),plans:{},ledger:{},favorites:{guest:[],cook:[]},requests:[],records:[],legacy:{},log:[]};
 for(const key of ['catalogVersion','catalogArchive'])if(Object.hasOwn(state,key))clean[key]=copy(state[key]);
 return clean;
}
function createHandler(cloud,{testTools=defaultTestTools,notificationWaitMs=2000}={}){
 const db=cloud.database(),table='mealFamilies',ids='mealIdentities';let ready;const imageURLs=new Map();
 const resetInfo=family=>({enabled:testTools.enabled===true,canRestore:testTools.enabled===true&&!!family.testResetBackup&&family.revision===family.testResetBackup.resetRevision,resetAt:family.testResetBackup?.resetAt||null,backupId:family.testResetBackup?.backupId||null});
const init=()=>ready||(ready=Promise.all([table,ids].map(async n=>{try{await db.createCollection(n)}catch(e){if(!/already exist|已存在|EXIST/.test(e.message||''))throw e}})).catch(e=>{ready=null;throw e}));
 const read=async doc=>{try{return (await doc.get()).data}catch(e){if(/not exist|not found|不存在|DOCUMENT_NOT_EXIST/i.test(e.message||'')||e.errCode===-1)return null;throw e}};
 const notifications=notificationsModule.createNotifications(cloud,{read,table,ids,waitMs:notificationWaitMs});
 return async(event={})=>{try{
 const uid=cloud.getWXContext().OPENID;if(!uid)throw Error('无法获取微信身份');
 const action=event.action||'get',data=event.data||{},resetAction=['resetTestData','restoreTestData'].includes(action);if(['create','join'].includes(action))await init();
 let identity=await read(db.collection(ids).doc(uid));
 if(action==='create'){
  if(identity)throw Error('你已加入饭桌，请刷新');
  const id=crypto.randomBytes(16).toString('hex'),code=crypto.randomBytes(12).toString('hex');
  await db.runTransaction(async t=>{if(await read(t.collection(ids).doc(uid)))throw Error('你已加入饭桌');await t.collection(table).doc(id).set({data:{code,members:[uid],state:catalog.migrate(model.initial()),revision:1,resetEpoch:0,createdAt:Date.now()}});await t.collection(ids).doc(uid).set({data:{familyId:id,role:['guest','cook'].includes(data.role)?data.role:'cook'}})});
  identity={familyId:id};
 }else if(action==='join'){
  if(identity)throw Error('你已加入饭桌，请刷新');
  const code=String(data.code||'').trim();if(!/^[a-f0-9]{24}$/.test(code))throw Error('请输入完整的饭桌邀请码');
  const rows=(await db.collection(table).where({code}).limit(1).get()).data;if(!rows.length)throw Error('邀请码不正确');const id=rows[0]._id;
  await db.runTransaction(async t=>{if(await read(t.collection(ids).doc(uid)))throw Error('你已加入饭桌');const doc=t.collection(table).doc(id),f=(await doc.get()).data;if(f.members.length>=2)throw Error('这张饭桌已有两人');await doc.update({data:{members:[...f.members,uid],revision:f.revision+1}});await t.collection(ids).doc(uid).set({data:{familyId:id,role:['guest','cook'].includes(data.role)?data.role:'guest'}})});identity={familyId:id};
 }
 if(!identity)return {ok:true,unbound:true};
 if(['create','join'].includes(action))identity=(await db.collection(ids).doc(uid).get()).data;
 const fid=identity.familyId,doc=db.collection(table).doc(fid),mutating=!['get','create','join','role','uploadImage','notificationPreferences'].includes(action);let family,compactPlanKey,notificationEvent;
 if(!mutating){family=(await doc.get()).data;if(!family.members.includes(uid))throw Error('无权访问这张饭桌');}
 if(action==='role'){
  if(!['guest','cook'].includes(data.role))throw Error('请选择身份');await db.collection(ids).doc(uid).update({data:{role:data.role}});identity.role=data.role;
 }else if(action==='notificationPreferences'){
  ({identity,family}=await notifications.preferences(uid,fid,data));
 }else if(action==='uploadImage'){
  if(identity.role!=='cook')throw Error('只有大厨可上传菜品图片');if(typeof data.base64!=='string'||data.base64.length>700000)throw Error('图片压缩后请小于500KB');const b=Buffer.from(data.base64,'base64');const png=b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=b[0]===255&&b[1]===216&&b[2]===255;if(!png&&!jpg)throw Error('只支持PNG或JPEG图片');const out=await cloud.uploadFile({cloudPath:`meals/${fid}/${crypto.randomBytes(16).toString('hex')}.${png?'png':'jpg'}`,fileContent:b});return {ok:true,fileID:out.fileID};
 }else if(mutating){
  await db.runTransaction(async t=>{notificationEvent=null;const currentIdentity=(await t.collection(ids).doc(uid).get()).data;const doc=t.collection(table).doc(fid),f=(await doc.get()).data;if(currentIdentity.familyId!==fid||!f.members.includes(uid)){if(resetAction)rejectReset('无权访问');throw Error('无权访问');}
   const epoch=f.resetEpoch||0;
   if(resetAction){
    if(testTools.enabled!==true)rejectReset('测试清空功能已关闭');
    if(typeof data.requestId!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(data.requestId))rejectReset('清空请求无效，请重试');
    const replay=(f.testResetRequests||[]).find(x=>x.id===data.requestId&&x.uid===uid);
    if(replay){if(replay.action!==action)rejectReset('清空请求已用于其他操作，请重试');family=f;identity=currentIdentity;return;}
   }
   if((resetAction||epoch>0)&&data.expectedResetEpoch!==epoch){const error=Error('测试数据已重置，请退出并重新打开最新版体验版');error.code='RESET_EPOCH_CHANGED';error.resetEpoch=epoch;throw error;}
   if(data.expectedRevision!==f.revision){if(resetAction)rejectReset('另一位已更新菜单，请刷新后再操作');throw Error('另一位已更新菜单，请刷新后再操作');}
   if(resetAction){
    const now=Date.now(),revision=f.revision+1,resetEpoch=epoch+1;
    let state,backup;
    if(action==='resetTestData'){
     state=resetUsage(f.state);
     // Repeated clears of an untouched empty state must keep the useful original backup.
     backup=f.testResetBackup&&f.revision===f.testResetBackup.resetRevision&&!hasUsage(f.state)
      ?{...f.testResetBackup,resetRevision:revision}
      :{state:copy(f.state),resetAt:now,backupId:crypto.randomBytes(16).toString('hex'),resetRevision:revision};
    }
    else{
     backup=f.testResetBackup;
     if(!backup)rejectReset('没有可还原的清空记录');
     if(f.revision!==backup.resetRevision)rejectReset('清空后已有新记录，不能直接还原；请保留现在的数据');
     state=copy(backup.state);backup=null;
    }
    const testResetRequests=[...(f.testResetRequests||[]),{id:data.requestId,uid,action,at:now,revision,resetEpoch}].slice(-16);
    const update={state,revision,resetEpoch,updatedAt:now,testResetBackup:backup,testResetRequests};
    // Plain objects in CloudBase update() merge nested fields, so empty maps do not erase old usage.
    await doc.update({data:{...update,state:db.command.set(state),testResetBackup:backup?db.command.set(backup):null}});family={...f,...update};identity=currentIdentity;return;
   }
   if(action==='recipe'&&data.recipe.image&&data.recipe.image!==f.state.recipes.find(r=>r.id===data.recipe.id)?.image&&!(data.recipe.image.startsWith('cloud://')&&data.recipe.image.includes(`/meals/${fid}/`)))throw Error('请重新上传当前饭桌的图片');
   const input={...data};if(input.period){const sat=input.period.sat;if(!/^\d{4}-\d{2}-\d{2}$/.test(sat||''))throw Error('菜单日期无效');const canonical=model.period(new Date(sat+'T12:00:00'),0);if(canonical.sat!==sat)throw Error('菜单日期无效');input.period=canonical;}const now=Date.now(),state=model.apply(f.state,currentIdentity.role,action,input,now);
   notificationEvent=notificationsModule.eventFor(action,input,f.state,state,epoch,now);
   // The model returns the complete snapshot, including fields deliberately removed by menu actions.
   await doc.update({data:{state:db.command.set(state),revision:f.revision+1,updatedAt:now}});family={...f,state,revision:f.revision+1};identity=currentIdentity;if(action==='selectDraft')compactPlanKey=model.planKey(input.type||'next',input.period);
  });
 }
 if(notificationEvent)await notifications.deliver(fid,uid,notificationEvent);
 const metadata={ok:true,role:identity.role,familyId:fid,revision:family.revision,resetEpoch:family.resetEpoch||0,testReset:resetInfo(family),notifications:notifications.metadata(identity),code:family.code,members:family.members.length};
 if(data.compact===true&&['selectDraft','favorite'].includes(action)){const patch=action==='favorite'?{favorites:family.state.favorites}:{plans:{[compactPlanKey]:family.state.plans[compactPlanKey]}};return {...metadata,baseRevision:data.expectedRevision,patch};}
 if(event.revision===family.revision&&action==='get')return {...metadata,unchanged:true};
 const state=JSON.parse(JSON.stringify(family.state)),images=[];
 function collect(v){if(!v||typeof v!=='object')return;if(typeof v.image==='string'&&v.image.startsWith('cloud://'))images.push(v);for(const x of Object.values(v))if(x&&typeof x==='object')collect(x);}
 collect(state);const files=[...new Set(images.map(r=>r.image))],now=Date.now(),missing=files.filter(id=>!imageURLs.has(id)||imageURLs.get(id).until<=now);
 if(missing.length){const urls=(await cloud.getTempFileURL({fileList:missing})).fileList;for(const x of urls)if(x.tempFileURL&&(x.status===0||x.status==null))imageURLs.set(x.fileID,{url:x.tempFileURL,until:now+20*60*1000});}
 for(const r of images){const x=imageURLs.get(r.image);if(x&&x.until>now)r.displayImage=x.url;}
 for(const [id,x] of imageURLs)if(x.until<=now)imageURLs.delete(id);
 return {...metadata,state};
 }catch(e){return {ok:false,error:e.message||'云端操作失败，请重试',...(e.code==='RESET_EPOCH_CHANGED'?{code:e.code,resetEpoch:e.resetEpoch}:e.code==='TEST_RESET_REJECTED'?{code:e.code}:{})}}};
}
module.exports={createHandler};
