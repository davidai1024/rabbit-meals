const s=require('./planning-service'),m=require('./planning'),life=require('./menu-lifecycle'),entry=require('./notification-entry');
const event=(e,k)=>e.currentTarget.dataset[k];
function planPeriod(p){const sat=p.type==='weekend'?p.start:m.addDays(p.start,-2),week=m.addDays(sat,2);return {sat,sun:m.addDays(sat,1),week,end:m.addDays(week,6),key:sat};}
function factory(shared,base){return {...shared,data:{...base(),historyType:'all',selectedKey:'',selected:null,orderedView:false,originOrders:false},
 onLoad(options={}){const key=entry.key(options.key);if(key)this.setData({selectedKey:key,orderedView:options.source==='ordered',originOrders:options.origin==='orders'});if(shared.onLoad)shared.onLoad.call(this);},
 onShow(){const key=entry.take();if(key){this.setData({selectedKey:key});if(this.state)this.refresh();}return shared.onShow.call(this);},
 refresh(){
  const selected=this.state.plans[this.data.selectedKey];
  const decorate=p=>({...p,statusLabel:life.label(p,'cook'),typeTitle:p.type==='next'?'下周的饭':'周末想吃',periodTitle:p.start+' — '+p.end,lines:p.lines.map(l=>{const r=(p.recipes||this.state.recipes).find(r=>r.id===l.id)||{};const feedback=this.state.records.filter(x=>x.key===p.key&&x.recipeId===l.id);return {...r,...l,image:s.display(r),tasks:l.tasks||{},feedback:feedback.map(x=>({...x,roleLabel:x.role==='cook'?'大厨':'点餐'})),myFeedback:feedback.find(x=>x.role===this.data.role),canCook:this.data.role==='cook'&&['confirmed','cooked','eaten'].includes(p.status)&&!(l.tasks||{}).cook};})});
  const history=Object.values(this.state.plans).filter(p=>p.status!=='draft'&&(this.data.historyType==='all'||p.type===this.data.historyType)).sort((a,b)=>b.start.localeCompare(a.start)).map(p=>{const x=decorate(p);return {...x,names:x.lines.map(l=>l.name).join('、'),photos:x.lines.slice(0,4)};});
  this.setData({history,selected:selected?decorate(selected):null,legacy:Object.values(this.state.legacy||{}).sort((a,b)=>String(b.week).localeCompare(String(a.week))).map(p=>({...p,names:p.lines.map(l=>(this.state.recipes.find(r=>r.id===l.id)||{}).name).join('、')}))});
 },
 historyType(e){this.setData({historyType:event(e,'type')});this.refresh();},
 detail(e){this.setData({selectedKey:event(e,'key'),error:''});this.refresh();},
 backFromHistory(){if(!this.data.orderedView)return this.review();const fallback=()=>wx.switchTab({url:this.data.originOrders?'/pages/v3-week/index':'/pages/v3-menu/index'});if(typeof wx.navigateBack==='function')return wx.navigateBack({fail:fallback});return fallback();},
 closeDetail(){if(this.data.orderedView)return this.backFromHistory();this.setData({selectedKey:'',selected:null,error:''});},
 historyChange(action,data={}){const old=this.state.plans[this.data.selectedKey];if(!old)return;return s.run(this,()=>s.after(s.call(action,{type:old.type,period:planPeriod(old),version:old.version,...data}),()=>this.load()));},
 confirmHistory(){this.historyChange('confirm');},
 cooked(e){const old=this.state.plans[this.data.selectedKey];if(old)return this.markCook(old.type,event(e,'id'),planPeriod(old));},
 record(e){if(this.data.role!=='guest'){this.setData({editing:null,error:'吃饭评价由点餐者填写'});return;}const id=event(e,'id'),line=this.data.selected.lines.find(l=>l.id===id);this.setData({editing:{form:'record',id,result:'吃完了',again:false,note:'',...line.myFeedback}});},
 again(){const again=!this.data.editing.again;clearTimeout(this.loveTimer);this.setData({editing:{...this.data.editing,again},loveBurst:again});if(again){this.loveTimer=setTimeout(()=>this.setData({loveBurst:false}),850);if(this.loveTimer.unref)this.loveTimer.unref();}},
 recordSave(){const x=this.data.editing;return s.after(this.historyChange('record',{id:x.recipeId||x.id,result:x.result,again:x.again,note:x.note}),()=>{if(!this.data.error){this.cancel();wx.showToast({title:'反馈已保存',icon:'success'});}});},
 reuse(e){
  if(!this.currentPeriod())return;
  const key=event(e,'key')||this.data.selectedKey,old=this.state.plans[key];if(!old)return;
  const target=m.getPlan(this.state,old.type,this.data.period);
  if(life.locked(target)){this.setData({error:'本期菜单已经开始制作，不能覆盖；下一期再复用。'});return;}
  const usable=old.lines.filter(l=>{const r=this.state.recipes.find(r=>r.id===l.id);return r&&!r.hidden&&m.complete(r);});
  if(!usable.length){this.setData({error:'这些菜目前均不可选，请回到点菜页重新选择。'});return;}
  const skipped=old.lines.length-usable.length;
  const lines=usable.map(l=>({id:l.id,multiplier:1,spice:l.spice||'不辣',note:l.note||'',day:old.type==='weekend'&&l.day===old.end?this.data.period.sun:this.data.period.sat,meal:l.meal||'午餐',people:l.people||1,fresh:l.fresh!==false}));
  this.showTip({title:'复用到本期草稿？',content:(old.type==='next'?'下周':'周末')+' '+target.start+' — '+target.end+'。将替换当前草稿，已提交菜单和采购不变。'+(skipped?'有'+skipped+'道已下架或资料不全的菜会跳过。':''),success:r=>{if(!r.confirm)return;return s.after(this.change('reuse',{type:old.type,lines,version:target.version}),()=>{if(!this.data.error){s.select(old.type,0);wx.switchTab({url:'/pages/v3-menu/index'});}});}});
 }
};}
module.exports={factory,planPeriod};
