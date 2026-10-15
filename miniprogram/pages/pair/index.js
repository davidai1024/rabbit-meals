const s=require('../../utils/planning-service'),nav=require('../../utils/role-navigation'),cfg=require('../../utils/config');
const notificationTemplates=cfg.notificationTemplates||[];
function notificationRows(meta={}){return notificationTemplates.map(template=>{
 const preference=meta.preferences&&meta.preferences[template.kind]||'unset',last=meta.last&&meta.last[template.kind];
 let status={unset:'尚未订阅',accept:'最近同意订阅',reject:'未同意 / 已关闭',ban:'微信已拒绝订阅'}[preference]||'尚未订阅';
 let detail=preference==='accept'?'一次授权可发送一条，需要时请再次订阅补充。':preference==='ban'?'请在微信的小程序设置中检查订阅消息权限。':'';
 if(last){
  if(last.status==='needsAuthorization'){status='需补充订阅';detail='未能发送上次提醒，请再次订阅。';}
  else if(last.status==='accepted'){status='上次通知微信已受理';detail='无法确认是否送达；可再次订阅补充后续提醒。';}
  else if(last.status==='pending'){status='上次提醒发送中';detail='发送结果尚未确认。';}
  else if(last.status==='unknown'){status='上次提醒结果待确认';detail='无法确认服务通知是否送达。';}
  else if(last.status==='failed'){status='上次提醒发送失败';detail='菜单和点评已保存，可进入饭桌查看。';}
  else if(last.status==='skipped'){status='上次提醒未发送';detail='身份或提醒设置已变化，可再次订阅。';}
 }
 return {kind:template.kind,title:template.title,status,detail};
});}
Page({
 data:{pageReady:false,pageLoading:true,pageLoadError:'',busy:false,error:'',unbound:true,code:'',role:'cook',members:0,invite:'',testToolsEnabled:false,canRestore:false,pendingAction:'',resetAction:'',resetNotice:'',notificationEnabled:false,notificationBusy:false,notificationNotice:'',notificationError:'',notificationPending:false,notificationRows:[],notificationOff:false},
 onLoad(){const r=s.info();if(r)this.applyInfo(r);},
 onShow(){return this.refresh();},
 applyInfo(r){
  if(!r)return;
  const pending=s.testResetStatus?s.testResetStatus():{};
  const reminders=r.notifications||{},preferences=reminders.preferences||{},notificationPending=s.notificationPreferenceStatus?s.notificationPreferenceStatus():{};
  this.setData({pageReady:true,pageLoading:false,pageLoadError:'',unbound:!!r.unbound,members:r.members||0,invite:r.code||'',role:r.role||this.data.role,testToolsEnabled:!!cfg.testToolsEnabled&&!!r.testReset?.enabled,canRestore:!!r.testReset?.canRestore,pendingAction:pending.pendingAction||'',notificationEnabled:!!reminders.enabled&&reminders.canSubscribe!==false&&r.role==='cook',notificationRows:notificationRows(reminders),notificationPending:!!notificationPending.pending,notificationOff:preferences.menu==='reject'&&preferences.review==='reject'});
 },
 refresh(){
  if(this._pageRefresh)return this._pageRefresh;
  if(!this.data.pageReady)this.setData({pageLoading:true,pageLoadError:''});
  this._pageRefresh=Promise.resolve().then(()=>s.sync(true)).then(r=>{if(!r)throw Error('饭桌还没准备好，请重试。');this.applyInfo(r);}).catch(()=>{if(!this.data.pageReady)this.setData({pageLoading:false,pageLoadError:'暂时连接不上，请检查网络后再试。'});}).finally(()=>{this._pageRefresh=null;});
  return this._pageRefresh;
 },
 retryPageLoad(){return this.refresh();},
 field(e){this.setData({code:e.detail.value.trim()});},
 role(e){this.setData({role:e.currentTarget.dataset.role});},
 create(){return s.run(this,async()=>{await s.pair('create',{role:this.data.role});this.next();});},
 join(){return s.run(this,async()=>{await s.pair('join',{role:this.data.role,code:this.data.code});this.next();});},
 copy(){wx.setClipboardData({data:this.data.invite});},
 next(){wx.switchTab({url:'/pages/'+nav.start(s.role())+'/index'});},
 subscribeReminders(){
  if(this.data.notificationBusy||!this.data.notificationEnabled||this.data.role!=='cook')return;
  if(typeof wx.requestSubscribeMessage!=='function'){this.setData({notificationError:'当前微信不支持订阅消息，请更新微信后再试。',notificationNotice:''});return;}
  this.setData({notificationBusy:true,notificationError:'',notificationNotice:''});let settled=false;
  const fail=()=>{if(settled)return;settled=true;this.setData({notificationBusy:false,notificationError:'未完成订阅，请在大厨本人手机的微信中重试，并检查订阅消息权限。'});};
  const success=result=>{
   if(settled)return;settled=true;const choices={},accepted=[],declined=[];
   for(const template of notificationTemplates){const answer=result&&result[template.id];if(['accept','reject','ban'].includes(answer)){choices[template.kind]=answer;(answer==='accept'?accepted:declined).push(template.title);}}
   if(!Object.keys(choices).length){this.setData({notificationBusy:false,notificationError:'没有获得有效订阅结果，请在大厨本人手机上重试。'});return;}
   const notice=[accepted.length?accepted.join('、')+'：本次订阅成功。':'',declined.length?declined.join('、')+'：本次未同意。':''].filter(Boolean).join('');
   return this.saveNotificationPreferences(choices,notice);
  };
  // Keep this API in the direct tap handler: requesting after network work loses the user gesture.
  try{const result=wx.requestSubscribeMessage({tmplIds:notificationTemplates.map(item=>item.id),success,fail});if(result&&typeof result.then==='function')result.then(success,fail);}catch(error){fail(error);}
 },
 async saveNotificationPreferences(choices,notice='',savedNotice=notice||'提醒设置已同步。'){
  this.setData({notificationBusy:true,notificationError:'',notificationNotice:notice,notificationPending:true});
  try{await s.notificationPreferences(choices);this.applyInfo(s.info());this.setData({notificationNotice:savedNotice,notificationPending:false});}
  catch(error){const pending=!!(s.notificationPreferenceStatus&&s.notificationPreferenceStatus().pending);this.setData({notificationError:'提醒设置尚未同步：'+(error.message||'请稍后重试')+'。'+(pending?'请点“重试同步设置”，无需重复授权。':'请稍后重试。'),notificationPending:pending});}
  finally{this.setData({notificationBusy:false});}
 },
 retryNotificationPreferences(){
  if(this.data.notificationBusy||!this.data.notificationEnabled)return;
  const pending=s.notificationPreferenceStatus&&s.notificationPreferenceStatus();if(pending&&pending.choices)return this.saveNotificationPreferences(pending.choices);
 },
 closeReminders(){if(this.data.notificationBusy||!this.data.notificationEnabled)return;return this.saveNotificationPreferences({menu:'reject',review:'reject'},'','饭桌提醒已关闭。微信授权可在小程序设置中管理。');},
 reset(){
  if(this.data.busy||!this.data.testToolsEnabled)return;
  wx.showModal({title:'清空测试数据？',content:'会同时清空两人的菜单、采购、制作、收藏、点评和统计记录。菜品库、绑定和身份保留。清空后可还原；开始新的使用记录后无法还原。',confirmText:'清空',confirmColor:'#c83f2b',success:r=>{if(r.confirm)this.performReset('resetTestData');}});
 },
 restore(){
  if(this.data.busy||!this.data.testToolsEnabled||!this.data.canRestore)return;
  wx.showModal({title:'还原上次清空？',content:'两人的菜单、采购、制作、收藏、点评和统计将恢复到上次清空前的状态。',confirmText:'还原',confirmColor:'#c83f2b',success:r=>{if(r.confirm)this.performReset('restoreTestData');}});
 },
 retryReset(){if(!this.data.busy&&this.data.pendingAction)return this.performReset(this.data.pendingAction);},
 async performReset(action){
  if(this.data.busy||!this.data.testToolsEnabled||!['resetTestData','restoreTestData'].includes(action))return;
  this.setData({resetAction:action,resetNotice:''});
  try{
   await s.run(this,async()=>{await s[action]();this.applyInfo(s.info());this.setData({resetNotice:action==='resetTestData'?'已清空，可以重新点菜。':'已还原上次清空前的记录。'});wx.showToast({title:action==='resetTestData'?'测试记录已清空':'记录已还原',icon:'success'});});
  }finally{this.applyInfo(s.info());this.setData({resetAction:''});}
 }
});
