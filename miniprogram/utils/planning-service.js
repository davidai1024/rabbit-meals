const model=require('./planning'),legacy=require('./service'),catalog=require('./catalog-migration');
const config=require('./config');
let cache=null,pending=null,ticket=0,applied=0,preview=null,activePage=null,lastVerified=0;
let transport=Promise.resolve(),draftWork=null,draftPage=null,draftError=null,slowTimer=null,slow=false,ordinaryWrites=0,blockingWrites=0,restoredFamily=null;
let draftGeneration=0,renderedBase=null,renderedToken=null,renderedGeneration=-1,renderedState=null;
let cookWork=null,cookPage=null,cookError=null,cookSlowTimer=null,cookSlow=false,restoredCookFamily=null,cookGeneration=0,renderedCookGeneration=-1,renderedCookRole=null;
let resetWork=null,resetting=false;
const connectedPages=new Set(),RESET_KEY='rabbit-meals-test-reset-intent-v1',EPOCH_KEY='rabbit-meals-reset-epoch-v1',NOTIFICATION_KEY='rabbit-meals-notification-preference-intent-v1';
const cooks=new Map(),COOK_KEY='rabbit-meals-cook-outbox-v1';
const drafts=new Map(),KEY='rabbit-meals-local-v3',DRAFT_KEY='rabbit-meals-draft-outbox-v1';
const copy=x=>JSON.parse(JSON.stringify(x));
function localState(){if(wx.getStorageSync('family-menu-mode')!=='demo')legacy.setMode('demo');let s=wx.getStorageSync(KEY);if(!s){s=model.initial(wx.getStorageSync('family-menu-demo-v1')||null);wx.setStorageSync(KEY,s);}if(s.catalogVersion!==catalog.version){const backup=KEY+'-before-'+catalog.version;if(!wx.getStorageSync(backup))wx.setStorageSync(backup,copy(s));s=catalog.migrate(s);wx.setStorageSync(KEY,s);}return copy(s);}
function role(){return cache&&cache.role||wx.getStorageSync('rabbit-meals-role')||'';}
function setLocalRole(value){if(!['guest','cook'].includes(value))throw Error('请选择身份');wx.setStorageSync('rabbit-meals-role',value);}
function selection(){return {type:wx.getStorageSync('rabbit-meals-type')||'next',offset:Number(wx.getStorageSync('rabbit-meals-offset')||0)};}
function select(type,offset){wx.setStorageSync('rabbit-meals-type',type);wx.setStorageSync('rabbit-meals-offset',offset);}
function enabled(){return !!(config.env&&wx.cloud&&wx.cloud.callFunction);}
function serial(fn){const next=transport.then(fn);transport=next.catch(()=>{});return next;}
function resetEpoch(value=cache){return Number(value&&value.resetEpoch)||0;}
function epochError(){const error=Error('使用记录已重置，请在最新菜单中重新操作');error.code='RESET_EPOCH_CHANGED';return error;}
function requireEpoch(epoch){if(epoch!==resetEpoch())throw epochError();}
function requireAvailable(){if(resetting)throw Error('正在重置使用记录，请稍后操作');}
function clearUsagePreviews(){
 drafts.clear();cooks.clear();draftGeneration++;cookGeneration++;draftError=null;cookError=null;preview=null;
 slow=false;cookSlow=false;clearTimeout(slowTimer);clearTimeout(cookSlowTimer);persistDrafts();persistCooks();
 select('next',0);renderedBase=null;renderedToken=null;renderedState=null;
 const pages=new Set(connectedPages);if(typeof getCurrentPages==='function')for(const page of getCurrentPages())pages.add(page);
 for(const page of pages){
  if(!page||!page.setData||!page.load||page.route&&!page.route.startsWith('pages/v3-'))continue;
  for(const name of ['basketTimer','loveTimer','successTimer'])clearTimeout(page[name]);
  page.swipeQueues={};page.browsePositions={};page.swipeLast=null;page.dragStart=null;page.dragDelta=null;page._tipCallback=null;page._shownError='';page._connectedRender=null;page._submissionPlanKey=null;
  const initial={editing:null,tip:null,chooseRole:false,error:'',draftSync:draftStatus(),cookSync:cookStatus(),flight:null,loveBurst:false,basketPulse:false,favoritePulse:false,swipeStyle:'',query:'',category:'全部',showSearch:false,selectedKey:'',selected:null,historyType:'all',scope:'all',expanded:'',feedback:'',suggestion:'',feedbackForm:null,submissionNote:'',editingDraft:false};
  if(page.route&&page.route.includes('/v3-week/'))initial.view='overview';
  if(page.route&&page.route.includes('/v3-menu/')){initial.viewMode='card';initial.weekDay='';initial.weekMeal='午餐';initial.cardIndex=0;}
  page.setData(Object.fromEntries(Object.entries(initial).filter(([key])=>Object.prototype.hasOwnProperty.call(page.data,key))));page.load();
 }
 notifyDraft();notifyCook();
}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).filter(key=>key!=='displayImage').sort().map(key=>[key,stable(value[key])]));return value;}
function planSignature(plan,ignoreVersion=false){const value=copy(plan);if(ignoreVersion)delete value.version;return JSON.stringify(stable(value));}
function keyFor(data){return model.planKey(data.type||'next',data.period);}
function persistDrafts(){if(!cache)return;wx.setStorageSync(DRAFT_KEY,drafts.size?{familyId:cache.familyId,resetEpoch:resetEpoch(),role:'guest',entries:[...drafts.values()].map(copy)}:null);}
function draftStatus(){const count=drafts.size;return {phase:draftError?draftError.phase:count?'saving':'idle',pending:count>0,slow:count>0&&slow,count,error:draftError&&draftError.message||'',canRetry:!!draftError&&draftError.phase!=='conflict'};}
function notifyDraft(refresh=false){const page=draftPage;if(!page||!page.setData)return;page.setData({draftSync:draftStatus()});if(refresh&&page.load)page.load();}
function markDraftError(error,phase){draftError={phase:phase||(/已更新菜单|已变更|菜单已更新/.test(error.message||'')?'conflict':'error'),message:error.message||'选择暂未同步，请重试'};slow=false;clearTimeout(slowTimer);persistDrafts();notifyDraft(true);}
function overlay(base){let result=base;for(const entry of drafts.values()){const plan=model.getPlan(result,entry.data.type,entry.data.period);try{result=model.apply(result,'guest','selectDraft',{...entry.data,version:plan.version});}catch(e){/* Keep the visible draft if a remote recipe became unavailable. */const next=copy(result);next.plans[entry.key]={...plan,draftLines:copy(entry.data.lines),version:plan.version+1};result=next;}}return result;}
function state(){if(!enabled())return localState();const base=cache&&cache.state||catalog.migrate(model.initial()),token=preview&&preview.token;if(renderedBase===base&&renderedToken===token&&renderedGeneration===draftGeneration&&renderedCookGeneration===cookGeneration&&renderedCookRole===role())return renderedState;renderedBase=base;renderedToken=token;renderedGeneration=draftGeneration;renderedCookGeneration=cookGeneration;renderedCookRole=role();renderedState=overlayCook(overlay(preview?{...base,favorites:preview.favorites}:base));return renderedState;}
function display(r){return legacy.display(r);}
function after(result,fn){return result&&result.then?result.then(fn):fn();}
function conflict(){const e=Error('另一位已修改这份菜单。你的选择已保留，请查看最新菜单后重新选择');e.code='conflict';return e;}
function restoreDrafts(){if(!cache||restoredFamily===cache.familyId)return;restoredFamily=cache.familyId;const saved=wx.getStorageSync(DRAFT_KEY);if(!saved||saved.familyId!==cache.familyId||!Array.isArray(saved.entries))return;if(resetEpoch(saved)!==resetEpoch()){wx.setStorageSync(DRAFT_KEY,null);return;}for(const entry of saved.entries){if(!entry.data||!Array.isArray(entry.data.lines)||!entry.baseline||entry.key!==keyFor(entry.data)||resetEpoch(entry)!==resetEpoch())continue;entry.resetEpoch=resetEpoch();drafts.set(entry.key,entry);}draftGeneration++;if(!drafts.size)return;if(cache.role!=='guest'){markDraftError(Error('待同步的选菜已保留，请切回点餐身份后重试'));return;}for(const entry of drafts.values()){const current=model.getPlan(cache.state,entry.data.type,entry.data.period);if(planSignature(current)!==planSignature(entry.baseline)&&!(entry.sent&&planSignature(current)===planSignature(entry.sent.plan))){markDraftError(conflict(),'conflict');return;}}notifyDraft(true);startDraftWork();}
async function rpc(action,data={}){
 const id=++ticket;let out;
 try{out=await wx.cloud.callFunction({name:'planningFamily',data:{action,data,...(action==='get'&&cache?{revision:cache.revision}:{})}});}catch(e){const error=Error(/FUNCTION_NOT_FOUND|FunctionName/.test(e.message||e.errMsg||'')?'共享服务尚未部署完成，请稍后重试':'暂时连不上共享饭桌，请稍后重试');error.code='network';throw error;}
 const r=out.result;if(!r||!r.ok){const error=Error(r&&r.error||'云端未响应，请重试');if(r&&r.code)error.code=r.code;else if(/已更新菜单|已变更|菜单已更新/.test(error.message))error.code='conflict';if(error.code==='RESET_EPOCH_CHANGED')await rpc('get');throw error;}if(id<applied)return cache||r;
 if(r.patch){if(!cache||!cache.state||r.baseRevision!==cache.revision){lastVerified=0;const error=Error('菜单已更新，请刷新后再操作');error.code='conflict';throw error;}const next={...cache.state};if(r.patch.plans)next.plans={...next.plans,...r.patch.plans};if(r.patch.favorites)next.favorites=r.patch.favorites;r.state=next;delete r.patch;delete r.baseRevision;}
 applied=id;lastVerified=Date.now();if(r.unbound){cache=null;return r;}
 const changed=!cache||!r.unchanged||r.role!==cache.role||r.members!==cache.members||r.code!==cache.code||JSON.stringify(r.notifications)!==JSON.stringify(cache.notifications);
 const roleChanged=!cache||r.role!==cache.role,previous=cache||wx.getStorageSync(EPOCH_KEY);
 const epochChanged=!!previous&&previous.familyId===r.familyId&&resetEpoch(previous)!==resetEpoch(r);
 cache={...cache,...r};if(changed)wx.setStorageSync('rabbit-meals-cloud-cache',cache);if(roleChanged)wx.setStorageSync('rabbit-meals-role',r.role);
 if(epochChanged){restoredFamily=cache.familyId;restoredCookFamily=cache.familyId;clearUsagePreviews();}
 const savedEpoch=wx.getStorageSync(EPOCH_KEY);if(!savedEpoch||savedEpoch.familyId!==cache.familyId||resetEpoch(savedEpoch)!==resetEpoch())wx.setStorageSync(EPOCH_KEY,{familyId:cache.familyId,resetEpoch:resetEpoch()});
 restoreDrafts();restoreCooks();return cache;
}
function reconcileDraft(entry){requireEpoch(resetEpoch(entry));const current=model.getPlan(cache.state,entry.data.type,entry.data.period);if(entry.sent&&planSignature(current)===planSignature(entry.sent.plan)){entry.baseline=copy(current);if(entry.sent.seq===entry.seq){drafts.delete(entry.key);draftGeneration++;persistDrafts();return false;}entry.sent=null;persistDrafts();return true;}if(planSignature(current)!==planSignature(entry.baseline))throw conflict();return true;}
async function drainDrafts(){
 while(drafts.size&&!draftError&&!resetting){const entry=drafts.values().next().value;if(cache.role!=='guest')throw Error('选菜尚未同步，请切回点餐身份后重试');if(!reconcileDraft(entry)){notifyDraft(true);continue;}
  const current=model.getPlan(cache.state,entry.data.type,entry.data.period),seq=entry.seq,input={...copy(entry.data),version:current.version,expectedRevision:cache.revision,expectedResetEpoch:resetEpoch(entry),compact:true};
  const predicted=model.apply(cache.state,'guest','selectDraft',input);entry.sent={seq,plan:copy(model.getPlan(predicted,entry.data.type,entry.data.period))};persistDrafts();
  try{await rpc('selectDraft',input);}catch(error){if(error.code!=='conflict')throw error;await rpc('get');if(!reconcileDraft(entry)){notifyDraft(true);continue;}entry.retries=(entry.retries||0)+1;if(entry.retries>2)throw Error('饭桌正有更新，请稍后重试');continue;}
  const saved=model.getPlan(cache.state,entry.data.type,entry.data.period);entry.baseline=copy(saved);entry.sent=null;delete entry.retries;if(seq===entry.seq){drafts.delete(entry.key);draftGeneration++;}persistDrafts();notifyDraft(true);
 }
}
function startDraftWork(refresh=false){
 if(resetting||draftWork||draftError||!drafts.size)return draftWork;
 slow=false;clearTimeout(slowTimer);slowTimer=setTimeout(()=>{if(drafts.size&&!draftError){slow=true;notifyDraft();}},600);if(slowTimer.unref)slowTimer.unref();
 draftWork=serial(async()=>{if(refresh)await rpc('get');await drainDrafts();}).catch(error=>{if(error.code!=='RESET_EPOCH_CHANGED')markDraftError(error,error.code==='conflict'?'conflict':undefined);}).finally(()=>{draftWork=null;if(!drafts.size){slow=false;clearTimeout(slowTimer);}notifyDraft();if(drafts.size&&!draftError&&!resetting)startDraftWork();});
 return draftWork;
}
function queueDraft(page,data={}){
 requireAvailable();
 if(!enabled())return call('selectDraft',data);
 if(!cache||!cache.state)throw Error('请先连接共享饭桌');if(blockingWrites)throw Error('正在处理菜单，请稍后选菜');if(draftError&&draftError.phase==='conflict')throw conflict();
 const input={...copy(data),type:data.type||'next'};delete input.expectedRevision;delete input.compact;
 // Validate against the visible draft before accepting the tap.
 model.apply(state(),role(),'selectDraft',input);
 const key=keyFor(input),existing=drafts.get(key);if(existing){existing.data=input;existing.seq++;}else drafts.set(key,{key,resetEpoch:resetEpoch(),data:input,baseline:copy(model.getPlan(cache.state,input.type,input.period)),seq:1,sent:null});
 draftGeneration++;if(page)draftPage=page;persistDrafts();notifyDraft();startDraftWork();return state();
}
function flushDraft(){if(!enabled())return state();return (async()=>{while(drafts.size){if(resetting){await resetWork;continue;}if(draftError){const e=Error(draftError.message);e.code=draftError.phase;throw e;}await (draftWork||startDraftWork());}return state();})();}
function retryDraft(){if(!enabled())return state();if(draftError&&draftError.phase==='conflict')return Promise.reject(conflict());draftError=null;for(const entry of drafts.values())delete entry.retries;notifyDraft();if(!drafts.size)return Promise.resolve(state());startDraftWork(true);return flushDraft();}
function discardDraftQueue(){if(!enabled())return state();return serial(async()=>{await rpc('get');drafts.clear();draftGeneration++;draftError=null;slow=false;clearTimeout(slowTimer);persistDrafts();notifyDraft(true);return state();});}
// Completed dishes are positive, idempotent intents; they never toggle a server value.
function cookSignature(plan){
 const value=copy(plan);for(const key of ['version','status','updatedAt','draftLines','draftIntent'])delete value[key];
 value.lines=value.lines.map(line=>{const next={...line};for(const key of ['tasks','actualMultiplier','storage','eatDate','reheat'])delete next[key];return next;});
 return JSON.stringify(stable(value));
}
function normalizeCookSignature(signature){
 try{
  const value=JSON.parse(signature);if(!value||Array.isArray(value)||typeof value!=='object'||!Array.isArray(value.lines))return signature;
  // Older outboxes included guest-only drafts. Keep every committed-menu field intact.
  delete value.draftLines;delete value.draftIntent;return JSON.stringify(stable(value));
 }catch(e){return signature;}
}
function cookConflict(){const e=Error('这份菜单已调整，待同步的制作记录已保留。请查看最新菜单后再处理');e.code='conflict';return e;}
function persistCooks(){if(!cache)return;wx.setStorageSync(COOK_KEY,cooks.size?{familyId:cache.familyId,resetEpoch:resetEpoch(),role:'cook',entries:[...cooks.values()].map(copy)}:null);}
function cookStatus(){const count=cooks.size;return {phase:cookError?cookError.phase:count?'saving':'idle',pending:count>0,slow:count>0&&cookSlow,count,error:cookError&&cookError.message||'',canRetry:!!cookError&&cookError.phase!=='conflict'&&role()==='cook'};}
function notifyCook(refresh=false){if(!cookPage||!cookPage.setData)return;cookPage.setData({cookSync:cookStatus()});if(refresh&&cookPage.load)cookPage.load();}
function markCookError(error){cookError={phase:error.code==='conflict'?'conflict':'error',message:error.message||'制作记录暂未同步，请重试'};cookSlow=false;clearTimeout(cookSlowTimer);persistCooks();notifyCook(true);}
function cookCurrent(entry,base=cache.state){
 requireEpoch(resetEpoch(entry));
 if(!cache||entry.familyId!==cache.familyId)throw cookConflict();
 const plan=model.getPlan(base,entry.data.type,entry.data.period);
 if(!['confirmed','cooked','eaten'].includes(plan.status)||cookSignature(plan)!==entry.signature)throw cookConflict();
 const line=plan.lines.find(x=>x.id===entry.data.id&&!x.cancelled);if(!line)throw cookConflict();
 return {plan,line};
}
function overlayCook(base){
 if(!cache||cache.role!=='cook')return base;let result=base;
 for(const entry of cooks.values()){try{const {plan,line}=cookCurrent(entry,result);if(!(line.tasks||{}).cook)result=model.apply(result,'cook','task',{...entry.data,task:'cook',checked:true,version:plan.version});}catch(e){/* A changed menu cannot inherit an old completion preview. */}}
 return result;
}
function reconcileCook(entry){
 const {line}=cookCurrent(entry);if(!(line.tasks||{}).cook)return true;
 cooks.delete(entry.key);cookGeneration++;persistCooks();return false;
}
function restoreCooks(){
 if(!cache||restoredCookFamily===cache.familyId)return;restoredCookFamily=cache.familyId;
 const saved=wx.getStorageSync(COOK_KEY);if(!saved||saved.familyId!==cache.familyId||saved.role!=='cook'||!Array.isArray(saved.entries))return;
 if(resetEpoch(saved)!==resetEpoch()){wx.setStorageSync(COOK_KEY,null);return;}
 let migrated=false;
 for(const entry of saved.entries){if(entry.familyId!==cache.familyId||!entry.data||!entry.data.period||!entry.data.id||!['next','weekend'].includes(entry.data.type)||typeof entry.signature!=='string'||entry.key!==keyFor(entry.data)+':'+entry.data.id||resetEpoch(entry)!==resetEpoch())continue;entry.resetEpoch=resetEpoch();const signature=normalizeCookSignature(entry.signature);if(signature!==entry.signature){entry.signature=signature;migrated=true;}cooks.set(entry.key,entry);}
 cookGeneration++;if(!cooks.size)return;
 if(migrated)persistCooks();
 if(cache.role!=='cook'){markCookError(Error('制作记录已保留，请切回大厨身份后同步'));return;}
 try{for(const entry of [...cooks.values()])reconcileCook(entry);}catch(error){markCookError(error);return;}
 notifyCook(true);startCookWork();
}
async function drainCooks(){
 while(cooks.size&&!cookError&&!resetting){
  if(cache.role!=='cook')throw Error('制作记录尚未同步，请切回大厨身份后重试');
  const entry=cooks.values().next().value;if(!reconcileCook(entry)){notifyCook(true);continue;}
  const current=model.getPlan(cache.state,entry.data.type,entry.data.period),input={...copy(entry.data),task:'cook',checked:true,version:current.version,expectedRevision:cache.revision,expectedResetEpoch:resetEpoch(entry),compact:true};
  try{await rpc('task',input);}catch(error){if(error.code!=='conflict')throw error;await rpc('get');if(!reconcileCook(entry)){notifyCook(true);continue;}entry.retries=(entry.retries||0)+1;if(entry.retries>2)throw Error('饭桌正在更新，请稍后重试');continue;}
  if(reconcileCook(entry))throw Error('制作记录未能保存，请重试');notifyCook(true);
 }
}
function startCookWork(refresh=false){
 if(resetting||cookWork||cookError||!cooks.size)return cookWork;
 cookSlow=false;clearTimeout(cookSlowTimer);cookSlowTimer=setTimeout(()=>{if(cooks.size&&!cookError){cookSlow=true;notifyCook();}},600);if(cookSlowTimer.unref)cookSlowTimer.unref();
 cookWork=serial(async()=>{if(refresh)await rpc('get');await drainCooks();}).catch(error=>{if(error.code!=='RESET_EPOCH_CHANGED')markCookError(error);}).finally(()=>{cookWork=null;if(!cooks.size){cookSlow=false;clearTimeout(cookSlowTimer);}notifyCook();if(cooks.size&&!cookError&&!resetting)startCookWork();});
 return cookWork;
}
function queueCook(page,data={}){
 requireAvailable();
 if(!data.period||!['next','weekend'].includes(data.type||'next')||typeof data.id!=='string')throw Error('请选择有效的菜单和菜品');
 const input={period:copy(data.period),type:data.type||'next',id:data.id};
 if(!enabled()){const current=model.getPlan(state(),input.type,input.period),line=current.lines.find(x=>x.id===input.id);if(role()!=='cook')throw Error('请切换为大厨身份');if(!line||line.cancelled)throw Error('菜品不存在');if(!['confirmed','cooked','eaten'].includes(current.status))throw Error('菜单确认后再执行做饭任务');if((line.tasks||{}).cook)return state();return call('task',{...input,task:'cook',checked:true,version:current.version});}
 if(!cache||!cache.state)throw Error('请先连接共享饭桌');if(role()!=='cook')throw Error('请切换为大厨身份');if(blockingWrites)throw Error('正在处理菜单，请稍后标记');if(cookError&&cookError.phase==='conflict')throw cookConflict();
 const current=model.getPlan(state(),input.type,input.period),key=keyFor(input)+':'+input.id,line=current.lines.find(x=>x.id===input.id&&!x.cancelled);
 if(!line)throw Error('菜品不存在');if(!['confirmed','cooked','eaten'].includes(current.status))throw Error('菜单确认后再执行做饭任务');if(cooks.has(key)||(line.tasks||{}).cook)return state();
 model.apply(state(),'cook','task',{...input,task:'cook',checked:true,version:current.version});
 cooks.set(key,{key,familyId:cache.familyId,resetEpoch:resetEpoch(),data:input,signature:cookSignature(model.getPlan(cache.state,input.type,input.period))});cookGeneration++;if(page)cookPage=page;persistCooks();notifyCook();startCookWork();return state();
}
function flushCook(){if(!enabled())return state();return (async()=>{while(cooks.size){if(resetting){await resetWork;continue;}if(cookError){const e=Error(cookError.message);e.code=cookError.phase;throw e;}await(cookWork||startCookWork());}return state();})();}
function retryCook(){if(!enabled())return state();if(role()!=='cook')return Promise.reject(Error('请切换为大厨身份后同步制作记录'));if(cookError&&cookError.phase==='conflict')return Promise.reject(cookConflict());cookError=null;for(const entry of cooks.values())delete entry.retries;notifyCook();if(!cooks.size)return Promise.resolve(state());startCookWork(true);return flushCook();}
function discardCookQueue(){if(!enabled())return state();return serial(async()=>{await rpc('get');cooks.clear();cookGeneration++;cookError=null;cookSlow=false;clearTimeout(cookSlowTimer);persistCooks();notifyCook(true);return state();});}
function flushWrites(){if(!enabled())return state();return (async()=>{while(drafts.size||cooks.size){await flushDraft();await flushCook();}return state();})();}
function call(action,data={}){
 requireAvailable();
 if(!enabled()){const next=model.apply(state(),role(),action,data);wx.setStorageSync(KEY,next);return next;}
 // Selection and positive completion queues bypass the page-level busy state.
 const intentEpoch=resetEpoch(),seen=data.period?copy(model.getPlan(state(),data.type||'next',data.period)):null;
 const optimistic=cache&&cache.state&&!preview&&action==='favorite',token=optimistic?{}:null;if(optimistic){preview={token,favorites:model.apply(cache.state,role(),action,data).favorites};if(activePage&&activePage.load)activePage.load();}
 const blocking=!['favorite','request'].includes(action);ordinaryWrites++;if(blocking)blockingWrites++;
 return Promise.resolve(flushWrites()).then(()=>serial(async()=>{
  requireEpoch(intentEpoch);const input={...data,expectedResetEpoch:intentEpoch,expectedRevision:cache&&cache.revision,compact:!!(cache&&cache.state)};
  if(seen&&data.version!=null&&Number(data.version)===seen.version){const current=model.getPlan(cache.state,data.type||'next',data.period);if(planSignature(current,true)!==planSignature(seen,true))throw conflict();input.version=current.version;}
  await rpc(action,input);return state();
 })).finally(()=>{if(preview&&preview.token===token)preview=null;ordinaryWrites--;if(blocking)blockingWrites--;});
}
function run(page,fn){
 if(page.data.busy)return;page.setData({busy:true,error:''});
 const fail=e=>{if(enabled()&&page.load)page.load();page.setData({error:e.message||'保存失败，请重试'});if(page.showTip&&!page._shownError)page.showTip({title:'需要处理一下',content:e.message||'保存失败，请重试'});if(enabled())return sync(true).then(()=>{if(page.load)page.load();}).catch(()=>{});};
 let waiting=false;try{const previous=activePage;activePage=page;let value;try{value=fn();}finally{activePage=previous;}if(value&&value.then){waiting=true;return Promise.resolve(value).catch(fail).finally(()=>page.setData({busy:false}));}return value;}catch(e){const value=fail(e);if(value&&value.then){waiting=true;return value.finally(()=>page.setData({busy:false}));}}finally{if(!waiting)page.setData({busy:false});}
}
function sync(force=false){if(!enabled())return null;if(draftWork||cookWork||ordinaryWrites||resetting)return Promise.resolve(cache);if(!force&&cache&&Date.now()-lastVerified<1500)return Promise.resolve(cache);if(!pending)pending=serial(()=>rpc('get')).finally(()=>pending=null);return pending;}
function setRole(value){requireAvailable();if(!enabled())return setLocalRole(value);const intentEpoch=resetEpoch(),write=()=>serial(()=>{requireEpoch(intentEpoch);return rpc('role',{role:value,expectedResetEpoch:intentEpoch});});ordinaryWrites++;blockingWrites++;let work;if(value==='guest'&&drafts.size&&role()!=='guest')work=Promise.resolve(flushCook()).then(write).then(()=>retryDraft());else if(value==='cook'&&cooks.size&&role()!=='cook')work=Promise.resolve(flushDraft()).then(write).then(()=>retryCook());else work=Promise.resolve(flushWrites()).then(write);return work.finally(()=>{ordinaryWrites--;blockingWrites--;});}
function pair(action,data){requireAvailable();if(!enabled())return rpc(action,data);const intentEpoch=resetEpoch();ordinaryWrites++;blockingWrites++;return Promise.resolve(flushWrites()).then(()=>serial(()=>{requireEpoch(intentEpoch);return rpc(action,{...data,expectedResetEpoch:intentEpoch});})).finally(()=>{ordinaryWrites--;blockingWrites--;});}
function resetUsage(action){
 if(resetWork){const running=wx.getStorageSync(RESET_KEY);return running&&running.action===action?resetWork:Promise.reject(Error('正在完成上次重置，请稍后操作'));}
 if(!enabled()||!cache||!cache.state)return Promise.reject(Error('请先连接共享饭桌再重置使用记录'));
 const stored=wx.getStorageSync(RESET_KEY),saved=stored&&stored.familyId===cache.familyId?stored:null;
 if(saved&&saved.action!==action)return Promise.reject(Error('上次重置的结果尚未确认，请先重试上次操作'));
 const intent=saved||{familyId:cache.familyId,action,requestId:'reset_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,14),expectedResetEpoch:resetEpoch()};
 wx.setStorageSync(RESET_KEY,intent);resetting=true;ordinaryWrites++;blockingWrites++;
 // Wait for transport already in flight, without forcing failed draft/cook outboxes to save.
 resetWork=serial(async()=>{
  try{await rpc(action,{requestId:intent.requestId,expectedResetEpoch:intent.expectedResetEpoch,expectedRevision:cache.revision});wx.setStorageSync(RESET_KEY,null);return state();}
  catch(error){if(['RESET_EPOCH_CHANGED','TEST_RESET_REJECTED'].includes(error.code))wx.setStorageSync(RESET_KEY,null);throw error;}
 }).finally(()=>{resetWork=null;resetting=false;ordinaryWrites--;blockingWrites--;if(drafts.size&&!draftError)startDraftWork();if(cooks.size&&!cookError)startCookWork();});
 return resetWork;
}
function resetTestData(){return resetUsage('resetTestData');}
function restoreTestData(){return resetUsage('restoreTestData');}
function testResetStatus(){const intent=wx.getStorageSync(RESET_KEY),valid=!!(intent&&cache&&intent.familyId===cache.familyId&&['resetTestData','restoreTestData'].includes(intent.action));return {pending:valid,pendingAction:valid?intent.action:''};}
function notificationPreferenceStatus(){const saved=wx.getStorageSync(NOTIFICATION_KEY);return {pending:!!(saved&&cache&&saved.familyId===cache.familyId&&role()==='cook'),choices:saved&&cache&&saved.familyId===cache.familyId&&role()==='cook'?copy(saved.choices):null};}
function notificationPreferences(choices){
 if(!enabled()||!cache||!cache.state)return Promise.reject(Error('请先连接共享饭桌再设置提醒'));
 if(role()!=='cook')return Promise.reject(Error('请由大厨本人开启提醒'));
 const input={};for(const kind of ['menu','review'])if(choices&&Object.prototype.hasOwnProperty.call(choices,kind)){if(!['accept','reject','ban'].includes(choices[kind]))return Promise.reject(Error('订阅结果无效，请重新操作'));input[kind]=choices[kind];}
 if(!Object.keys(input).length)return Promise.reject(Error('未获得有效的订阅选择'));
 const familyId=cache.familyId;wx.setStorageSync(NOTIFICATION_KEY,{familyId,choices:input});
 return serial(async()=>{
  requireAvailable();if(!cache||cache.familyId!==familyId||role()!=='cook')throw Error('饭桌或身份已变化，请重新设置提醒');
  await rpc('notificationPreferences',{choices:input});
  const stored=wx.getStorageSync(NOTIFICATION_KEY);if(stored&&stored.familyId===familyId&&JSON.stringify(stored.choices)===JSON.stringify(input))wx.setStorageSync(NOTIFICATION_KEY,null);
  return cache;
 });
}
function info(){return cache;}
function contentReady(){return !enabled()||!!(cache&&!cache.unbound&&cache.state&&['guest','cook'].includes(cache.role));}
function disconnect(page){connectedPages.delete(page);if(draftPage===page)draftPage=null;if(cookPage===page)cookPage=null;}
function currentPage(page){if(typeof getCurrentPages!=='function')return true;const pages=getCurrentPages();return pages[pages.length-1]===page;}
function loadConnectedPage(page){
 const snapshot=state(),currentRole=role(),type=selection().type,week=model.period().key;
 const rendered=page.state?{state:page.state,role:page.data.role,type:page.data.type,week:page.data.period&&page.data.period.key}:page._connectedRender;
 if(page.data.pageReady!==false&&rendered&&rendered.state===snapshot&&rendered.role===currentRole&&rendered.type===type&&rendered.week===week)return;
 page.load();
 // Keep the same narrow check for callers whose load() does not retain business state.
 page._connectedRender={state:state(),role:role(),type:selection().type,week:model.period().key};
}
function navigateConnectedPage(page,kind,url){
 if(page._connectionDestination===url)return;
 page._connectionDestination=url;page.setData({pageReady:false,pageLoading:true,pageLoadError:''});
 if(page.getTabBar&&page.getTabBar())page.getTabBar().sync();
 wx[kind]({url,fail:()=>{if(currentPage(page))page.setData({pageLoading:false,pageLoadError:'暂时连接不上，请检查网络后再试。'});},complete:()=>{page._connectionDestination=null;}});
}
function presentConnectedPage(page,response){
 if(!currentPage(page))return;
 if(response&&response.unbound){navigateConnectedPage(page,'navigateTo','/pages/pair/index');return;}
 if(!response||!contentReady())throw Error('饭桌还没准备好，请重试。');
 const route=page.route&&page.route.split('/')[1],target=require('./role-navigation').resolve(role(),route);
 if(route&&target!==route){navigateConnectedPage(page,'switchTab','/pages/'+target+'/index');return;}
 loadConnectedPage(page);
}
function connect(page,force=false){
 connectedPages.add(page);
 draftPage=page;cookPage=page;notifyDraft();notifyCook();if(!enabled()){page.load();return;}if(legacy.isDemo())legacy.setMode('cloud');
 const nav=require('./role-navigation'),route=page.route&&page.route.split('/')[1];
 const routeAllowed=()=>!route||nav.resolve(role(),route)===route;
 const hasState=contentReady();if(hasState&&routeAllowed())loadConnectedPage(page);else page.setData({pageReady:false,pageLoading:true,pageLoadError:''});
 return Promise.resolve(sync(force)).then(r=>presentConnectedPage(page,r)).catch(()=>{if(currentPage(page)&&page.data.pageReady!==true)page.setData({pageReady:false,pageLoading:false,pageLoadError:'暂时连接不上，请检查网络后再试。'});});
}
function watch(page){connectedPages.add(page);draftPage=page;cookPage=page;clearInterval(page.cloudTimer);if(!enabled())return;page.cloudTimer=setInterval(()=>{if(page.data.pageReady===false||page.data.busy||page.data.editing||page.data.chooseRole||page.data.tip)return;sync().then(r=>presentConnectedPage(page,r)).catch(()=>{});},5000);if(page.cloudTimer.unref)page.cloudTimer.unref();}
module.exports={state,role,setRole,selection,select,call,display,run,KEY,DRAFT_KEY,enabled,after,sync,pair,info,contentReady,connect,watch,disconnect,queueDraft,draftStatus,retryDraft,flushDraft,discardDraftQueue,queueCook,cookStatus,retryCook,flushCook,discardCookQueue,COOK_KEY,resetTestData,restoreTestData,testResetStatus,RESET_KEY,notificationPreferences,notificationPreferenceStatus,NOTIFICATION_KEY};
