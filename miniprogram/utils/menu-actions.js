const s=require('./planning-service'),m=require('./planning'),life=require('./menu-lifecycle');
function ui(plan,role){const draft=Array.isArray(plan.draftLines),view=life.editable(plan,role);return {stateLabel:life.label(plan,role),hasDraft:draft,actionLabel:role==='cook'?(plan.status==='submitted'?'确认菜单':plan.status==='draft'?'等待提交':'已确认'):(plan.status==='draft'||draft?'提交菜单':'修改菜单'),view};}
function overview(plan,role,state){
 const presentation=ui(plan,role),view=presentation.view,editing=role==='guest'&&presentation.hasDraft&&plan.status!=='draft';
 const pending=role==='guest'&&!life.locked(plan)&&(plan.status==='draft'||presentation.hasDraft),counts=m.counts(state,view);
 const ready=view.lines.length>0&&(plan.type!=='next'||counts.valid);
 return {badge:editing?'修改待提交':{draft:'待提交',submitted:'待大厨确认',confirmed:'已确认',cooked:'已制作',eaten:'已用餐'}[plan.status]||'待提交',
  statusTone:editing||plan.status==='draft'?'draft':plan.status==='submitted'?'waiting':'done',
  locked:life.locked(plan),showModify:role==='guest'&&!pending&&!life.locked(plan),showSubmit:pending&&ready,showPick:pending&&!ready,showConfirm:role==='cook'&&plan.status==='submitted',
  submitLabel:editing?'重新提交':'提交菜单',pickLabel:view.lines.length?'继续选菜':'去选菜',previewLabel:editing?'修改草稿':'',
  count:view.lines.length,names:view.lines.map(l=>((view.recipes||state.recipes).find(r=>r.id===l.id)||{}).name).filter(Boolean).join('、')};
}
const actions={
 celebrate(title){wx.showToast({title,icon:'success',duration:2000});},
 basket(){this.setData({editing:{form:'basket'}});},
 basketSubmit(){this.cancel();this.submit();},
 basketDiscard(){this.showTip({title:'取消这次修改？',content:'未提交的改动将放弃，原菜单保持有效。',success:r=>{if(r.confirm){return s.after(this.discard(),()=>{if(!this.data.error)this.cancel();});}}});},

 currentPeriod(){const current=m.period();if(current.key!==this.data.period.key){this.setData({editing:null,feedback:'已进入新一周，请重新选择本期菜单'});this.load();wx.showToast({title:'已进入新一周',icon:'none'});return false;}return true;},
 watchPeriod(){clearInterval(this.periodTimer);this.periodTimer=setInterval(()=>this.currentPeriod(),30000);if(this.periodTimer.unref)this.periodTimer.unref();},
 onHide(){clearInterval(this.cloudTimer);clearInterval(this.periodTimer);clearTimeout(this.successTimer);this.setData({success:null});},onUnload(){clearInterval(this.cloudTimer);clearInterval(this.periodTimer);clearTimeout(this.successTimer);s.disconnect(this);},
 submit(e){
  if(!this.currentPeriod()||this.data.busy)return;
  const type=e?.currentTarget?.dataset?.type||this.data.type,state=s.state(),plan=m.getPlan(state,type,this.data.period);
  if(s.role()!=='guest'){this.setData({error:'请切换为点餐身份后提交'});return;}
  if(life.locked(plan)){this.load();this.setData({error:'这份菜单已经开始制作，本期不能换菜。'});return;}
  const lines=Array.isArray(plan.draftLines)?plan.draftLines:plan.status==='draft'?plan.lines:[];
  if(!lines.length){this.setData({error:'先挑几道喜欢的菜，再交给大厨。'});return;}
  const counts=m.counts(state,{...plan,lines,recipes:null});
  if(type==='next'&&!counts.valid){this.setData({error:'请选满3道荤菜和3道素菜后提交'});return;}
  const same=plan.status!=='draft'&&life.sameOrder(plan.lines,life.fixed(lines,state),type);
  const commit=confirmed=>this.commitOrder(type,plan.version,confirmed,same);
  if(plan.status!=='draft'&&life.draftIntent(plan)==='replacement'){
   this.showTip({title:type==='next'?'重新安排下周饭？':'重新安排周末饭？',content:(type==='next'?'下周':'周末')+'的饭已经点好啦。'+(same?'这一篮和原菜单一样，确认后收好这篮菜，原菜单和大厨的接单进度都会保留。':'提交这一篮会整份替换原菜单，大厨需要重新接单。取消会留着这一篮，原菜单继续有效。'),confirmText:'替换菜单',cancelText:'取消',success:r=>{if(r.confirm)return commit(true);}});return;
  }
  return commit(false);
 },
 commitOrder(type,version,replaceConfirmed,same){
  if(!this.currentPeriod()||this.data.busy)return;
  const fresh=m.getPlan(s.state(),type,this.data.period);
  if(life.locked(fresh)){this.load();this.setData({error:'这份菜单已经开始制作，本期不能换菜。'});return;}
  const key=m.planKey(type,this.data.period);
  return s.after(this.change('submitMenu',{type,version,replaceConfirmed}),()=>{
   if(this.data.error)return;
   this.swipeLast=null;this._submissionPlanKey=key;
   this.setData({editing:null,canUndo:false,submissionNote:same?'这份已经安排好啦，安心等饭香。':'想吃的已交给大厨，去「已点」等饭香。'});
  });
 },
 modify(e,discardReplacement=false){
  if(!this.currentPeriod()||this.data.busy||this.data.modifyingMenu)return;
  const type=e?.currentTarget?.dataset?.type||this.data.type,plan=m.getPlan(s.state(),type,this.data.period);
  if(life.locked(plan)){this.load();this.setData({error:'菜单已开始制作，不能再改菜；可以查看已点菜单。'});return;}
  if(plan.status==='draft')return;
  if(!discardReplacement&&life.draftIntent(plan)==='replacement'&&plan.draftLines?.length){
   this.showTip({title:'改原来的菜单？',content:'你已经重新挑了一篮菜。修改原菜单会放下这一篮，并带入原来点好的菜。',confirmText:'修改原菜单',cancelText:'留着这一篮',success:r=>{if(r.confirm)return this.modify(e,true);}});return;
  }
  this.setData({modifyingMenu:true,error:''});
  const finish=()=>this.setData({modifyingMenu:false});
  const success=()=>{s.select(type,0);this.load();if(this.route?.includes('v3-week')||this.data.summaries)wx.switchTab({url:'/pages/v3-menu/index'});};
  const fail=error=>{const show=()=>{this.load();this.setData({error:error.message||'修改未开始，请重试'});};if(s.enabled())return Promise.resolve(s.sync(true)).catch(()=>{}).then(show);show();};
  let waiting=false;
  try{const result=s.call('startEdit',{type,period:this.data.period,version:plan.version,discardReplacement});if(result&&result.then){waiting=true;return Promise.resolve(result).then(success).catch(fail).finally(finish);}success();return result;}
  catch(error){const result=fail(error);if(result&&result.then){waiting=true;return result.finally(finish);}}
  finally{if(!waiting)finish();}
 },
 discard(){return s.after(this.change('discardDraft'),()=>{if(!this.data.error){this.swipeLast=null;this.setData({canUndo:false,editing:null,submissionNote:''});}});},
 confirm(e){if(!this.currentPeriod())return;const type=e?.currentTarget?.dataset?.type||this.data.type,plan=m.getPlan(s.state(),type,this.data.period);return s.after(this.change('confirm',{type,version:plan.version}),()=>{if(!this.data.error){this.celebrate('菜单已确认');}});},
 remove(e){if(!this.currentPeriod())return;return s.after(this.change('selectDraft',{lines:this.data.plan.lines.filter(l=>l.id!==e.currentTarget.dataset.id)}),()=>{});}
};
module.exports={ui,overview,actions};
