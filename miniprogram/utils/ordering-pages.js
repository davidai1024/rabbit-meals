'use strict';
const s=require('./planning-service'),m=require('./planning'),life=require('./menu-lifecycle'),flow=require('./menu-actions'),feed=require('./ordered-feed');
const event=(e,key)=>e.currentTarget.dataset[key];
const range=(a,b)=>{const fmt=x=>Number(x.slice(5,7))+'月'+Number(x.slice(8,10))+'日';return fmt(a)+' — '+fmt(b);};
function load(page,picker){
 const state=s.state(),role=s.role(),type=s.selection().type,period=m.period(),submittedPlan=m.getPlan(state,type,period),locked=life.locked(submittedPlan),hasDraft=Array.isArray(submittedPlan.draftLines);
 const editingDraft=picker&&role==='guest'&&!locked&&submittedPlan.status!=='draft'&&hasDraft&&life.draftIntent(submittedPlan)==='edit',roleChanged=page.data.role!==role;
 // Picking a fresh basket must never project the last submitted dishes back into it.
 const plan=picker?{...submittedPlan,lines:locked?[]:hasDraft?submittedPlan.draftLines:submittedPlan.status==='draft'?submittedPlan.lines:[],recipes:null}:submittedPlan;
 const status=picker?(editingDraft?'修改中 · 待重新提交':locked?'本期已开做':hasDraft||plan.lines.length?'这篮待提交':'挑点想吃的'):life.label(submittedPlan,'cook');
 page.state=state;
 page.setData({role,roleLabel:role==='cook'?'大厨':'点餐者',chooseRole:!role,type,offset:0,period,submittedPlan,plan,hasDraft,editingDraft,menuLocked:locked,...(!picker&&roleChanged?{view:'overview'}:{}),
  nextRange:range(period.week,period.end),weekendRange:range(period.sat,period.sun),currentRange:range(submittedPlan.start,submittedPlan.end),
  status,stateLabel:status,actionLabel:editingDraft?'重新提交菜单':'提交菜单',counts:m.counts(state,plan),
  lines:plan.lines.map(line=>{const recipe=(plan.recipes||state.recipes).find(r=>r.id===line.id)||{};return {...recipe,...line,image:s.display(recipe),tasks:line.tasks||{},kind:recipe.kind,hasFeedback:state.records.some(r=>r.key===plan.key&&r.recipeId===line.id&&r.role===role)};}),
  requests:state.requests.filter(r=>r.status==='待补录'),
  ...(picker&&locked&&['dish','basket'].includes(page.data.editing?.form)?{editing:null}:{})});
 page.refresh();if(page.getTabBar&&page.getTabBar())page.getTabBar().sync();
}
function menu(shared,base){return {...shared,data:{...base(),category:'全部',query:'',categories:['全部','荤菜','素菜','常点','收藏'],filtered:[],flight:null,modifyingMenu:false,editingDraft:false,submissionNote:'',orderNotice:{visible:false,text:'',locked:false,key:''}},
 load(){load(this,true);},
 viewOrderedMenu(){const plan=this.data.submittedPlan;if(!plan||plan.status==='draft')return;wx.navigateTo({url:'/pages/v3-history/index?source=ordered&key='+encodeURIComponent(plan.key)});},
 cancelOrderEdit(){this.showTip({title:'放下这次修改？',content:'未提交的改动会放弃，大厨继续按原菜单准备。',confirmText:'保留原菜单',cancelText:'继续修改',success:r=>{if(r.confirm)return this.discard();}});},
 refresh(){
  const plan=this.data.submittedPlan,name=this.data.type==='next'?'下周':'周末',submitted=plan.status!=='draft'&&plan.lines.length>0;
  if(this.data.hasDraft||this._submissionPlanKey!==plan.key)this.setData({submissionNote:''});
  this.setData({orderNotice:{visible:submitted,key:plan.key,locked:this.data.menuLocked,text:this.data.menuLocked?'这份菜单已经开做啦，本期不能换菜。':name+'已安排 '+plan.lines.length+' 道菜，重新点好后可替换。'}});
  const frequency={};for(const p of Object.values(this.state.plans))if(p.status!=='draft')for(const line of p.lines)frequency[line.id]=(frequency[line.id]||0)+1;
  const favorites=this.state.favorites[this.data.role]||[];
  let recipes=this.state.recipes.filter(r=>!r.hidden).map(r=>({...r,image:s.display(r),favorite:favorites.includes(r.id),frequency:frequency[r.id]||0,complete:m.complete(r),selected:this.data.plan.lines.some(l=>l.id===r.id)}));
  const category=this.data.category;recipes=recipes.filter(r=>(!this.data.query||r.name.includes(this.data.query))&&(category==='全部'||r.category===category||category==='收藏'&&r.favorite||category==='常点'&&r.frequency));
  if(category==='常点')recipes.sort((a,b)=>b.frequency-a.frequency);
  const unavailable=this.data.plan.lines.filter(l=>{const r=this.state.recipes.find(r=>r.id===l.id);return !r||r.hidden;}).map(l=>(this.state.recipes.find(r=>r.id===l.id)||{}).name||l.id);
  this.setData({filtered:recipes,total:this.data.plan.lines.length,unavailableNotice:!this.data.menuLocked&&unavailable.length?'已选的'+unavailable.join('、')+'已下架，请打开购物车取消后换菜。原菜单仍有效。':''});
 },
 category(e){this.setData({category:event(e,'value')});this.refresh();},search(e){this.setData({query:e.detail.value});this.refresh();},
 open(e){
  if(!this.currentPeriod())return;if(this.data.role!=='guest'){this.setData({error:'点菜请切换为点餐身份；大厨可在「菜品库」管理菜品。'});return;}
  const id=event(e,'id'),r=this.state.recipes.find(x=>x.id===id);if(!m.complete(r)){this.setData({error:(r?.name||'这道菜')+'的采购量待大厨核实，请补全后再点。'});return;}
  if(this.data.menuLocked){this.setData({error:'这份菜单已经开始制作，本期不能换菜。'});return;}
  if(this.data.type==='next'){const lines=this.data.plan.lines.some(l=>l.id===id)?this.data.plan.lines.filter(l=>l.id!==id):[...this.data.plan.lines,{id,multiplier:1,spice:'不辣'}];return this.change('selectDraft',{lines});}
  const line=this.data.plan.lines.find(x=>x.id===id)||{};this.setData({error:'',editing:{form:'dish',id,name:r.name,image:s.display(r),multiplier:1,spice:'不辣',note:'',day:this.data.period.sat,meal:'午餐',people:1,fresh:true,...line}});
 },
 adjust(e){const x=this.data.editing,key=event(e,'key');this.setData({editing:{...x,[key]:Math.max(key==='people'?1:.25,Math.min(20,Number(x[key])+Number(event(e,'delta'))))}});},
 save(){const x=this.data.editing,lines=this.data.plan.lines.filter(l=>l.id!==x.id);lines.push(x);return s.after(this.change('selectDraft',{lines}),()=>{if(!this.data.error)this.cancel();});},
 favorite(e){const id=event(e,'id'),r=this.state.recipes.find(x=>x.id===id),was=(this.state.favorites[this.data.role]||[]).includes(id);return s.after(this.change('favorite',{id}),()=>{if(!this.data.error&&!was){this.setData({flight:{id,image:s.display(r)},favoritePulse:true});const timer=setTimeout(()=>this.setData({flight:null,favoritePulse:false}),450);if(timer.unref)timer.unref();}});},remove:flow.actions.remove
};}
function week(def){return {...def,data:{...def.data,currentOrders:[],pastOrders:[],hasOrdered:false},
 load(){load(this,false);},
 refresh(){
  def.refresh.call(this);
  const committed={...this.data.submittedPlan};delete committed.draftLines;delete committed.draftIntent;
  this.setData({...feed.feed(this.state,this.data.role,this.data.period,s.display),detail:{...flow.overview(committed,this.data.role,this.state),showModify:this.data.role==='guest'&&committed.status!=='draft'&&!life.locked(committed)}});
 },
 openPlan(e){
  const key=event(e,'key'),type=event(e,'type'),current=m.getPlan(s.state(),type,this.data.period);
  if(key&&key!==current.key){wx.navigateTo({url:'/pages/v3-history/index?source=ordered&origin=orders&key='+encodeURIComponent(key)});return;}
  s.select(type,0);this.setData({view:'menu',error:''});this.load();
 }
};}
module.exports={menu,week};
