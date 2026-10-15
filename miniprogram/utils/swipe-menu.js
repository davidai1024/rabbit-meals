'use strict';
const service=require('./planning-service');
const clone=x=>JSON.parse(JSON.stringify(x));
const signature=lines=>JSON.stringify(lines.map(l=>Object.keys(l).sort().reduce((o,k)=>{o[k]=l[k];return o;},{})));
const life=require('./menu-lifecycle');
const data=e=>e.currentTarget.dataset;
function enhance(base){
return {...base,data:{...base.data,viewMode:'card',card:null,queueLeft:0,canUndo:false,showSearch:false,swipeStyle:'',weekDay:'',weekMeal:'午餐'},
queueKey(){return this.data.period.key+'|'+this.data.type+'|'+this.data.category+'|'+this.data.query;},
refresh(){base.refresh.call(this);this.swipeQueues=this.swipeQueues||{};const key=this.queueKey(),skipped=this.swipeQueues[key]||[],cards=this.data.filtered.filter(r=>!r.selected&&!skipped.includes(r.id));
this.browsePositions=this.browsePositions||{};const index=cards.length?(this.browsePositions[key]||0)%cards.length:0;this.browsePositions[key]=index;
const allDone=this.data.type==='next'&&this.data.counts.valid;
const target=this.data.type==='next'?(this.data.counts.meat>=3&&this.data.counts.veg<3?'素菜':this.data.counts.veg>=3&&this.data.counts.meat<3?'荤菜':''):'';
this.setData({carouselCards:cards,card:cards[index]||null,nextCard:cards.length>1?cards[(index+1)%cards.length]:null,previousCard:cards.length>1?cards[(index+cards.length-1)%cards.length]:null,cardNumber:String(index+1).padStart(2,'0'),cardIndex:index,cardDots:Array.from({length:Math.min(cards.length,5)},(_,i)=>({id:i,active:i===index%5})),queueLeft:cards.length,canUndo:!!this.swipeLast&&this.swipeLast.key===key,swipeStyle:'',allDone,nextCategory:target,
weekDay:[this.data.period.sat,this.data.period.sun].includes(this.data.weekDay)?this.data.weekDay:this.data.period.sat,
selectedThumbs:this.data.lines.slice(0,6),cardReady:!this.data.menuLocked&&this.data.role==='guest',
emptyTitle:allDone?'选齐了':'暂无待选菜'});
},
switchView(e){const mode=data(e).mode;if(!['card','list'].includes(mode))return;this.touchCancel();this.setData({viewMode:mode});},
browse(step){if(!this.currentPeriod()||!this.data.card||this.data.queueLeft<2)return;const key=this.queueKey();this.browsePositions[key]=(this.data.cardIndex+step+this.data.queueLeft)%this.data.queueLeft;this.setData({error:'',feedback:''});this.refresh();},
carouselChange(e){const i=Number(e.detail.current);if(!Number.isInteger(i)||i<0||i>=this.data.queueLeft)return;this.browsePositions[this.queueKey()]=i;this.refresh();},
previousDish(){this.browse(-1);},nextDish(){this.browse(1);},
pickDish(e){this.pickCard(e);},
toggleView(){this.switchView({currentTarget:{dataset:{mode:this.data.viewMode==='card'?'list':'card'}}});},
openPurpose(){this.setData({editing:this.data.editing?.form==='purpose'?null:{form:'purpose'}});},
dismissPurpose(){if(['purpose','basket'].includes(this.data.editing?.form))this.cancel();},
keepPanel(){},
openFilters(){this.setData({editing:{form:'filters'}});},
choosePurpose(e){const type=data(e).type;if(!['next','weekend'].includes(type))return;service.select(type,0);this.setData({error:'',feedback:''});this.load();if(type==='next')this.cancel();},
filterPick(e){this.category(e);this.cancel();},
category(e){this.setData({category:data(e).value,error:'',swipeStyle:''});this.refresh();},
search(e){this.setData({query:e.detail.value,error:''});this.refresh();},
toggleSearch(){this.setData({showSearch:!this.data.showSearch});if(!this.data.showSearch){this.setData({query:''});this.refresh();}},
chooseDay(e){this.setData({weekDay:data(e).value});},chooseMeal(e){this.setData({weekMeal:data(e).value});},
replay(){this.swipeQueues[this.queueKey()]=[];this.swipeLast=null;this.setData({error:''});this.refresh();},
nextGroup(){this.category({currentTarget:{dataset:{value:this.data.nextCategory||'全部'}}});},
skipCard(){if(!this.currentPeriod()||!this.data.card)return;const key=this.queueKey(),id=this.data.card.id;this.swipeQueues[key]=[...(this.swipeQueues[key]||[]),id];this.swipeLast={kind:'skip',id,key};this.setData({error:'',feedback:''});this.refresh();},
pickCard(e){
const chosen=e?.currentTarget?.dataset?.id?this.data.filtered.find(r=>r.id===data(e).id):this.data.card;
if(!this.currentPeriod()||this.data.busy)return;
if(!chosen)return;
if(this.data.role!=='guest'){this.setData({error:'请切换为点餐身份'});return;}
if(!this.data.cardReady){this.setData({error:this.data.menuLocked?'这份菜单已经开始制作，请到「已点」查看':'请切换为点餐身份'});return;}
const card=chosen,key=this.queueKey(),before=clone(this.data.plan.lines);
const line={id:card.id,multiplier:1,spice:'不辣',...(this.data.type==='weekend'?{day:this.data.weekDay,meal:this.data.weekMeal,people:1,fresh:true}:{})};
const lines=chosen.selected?before.filter(l=>l.id!==card.id):[...before,line];
return service.after(this.change('selectDraft',{lines}),()=>{
if(!this.data.error){this.swipeLast={kind:'pick',id:card.id,key,before,after:clone(this.data.plan.lines),version:this.data.plan.version};this.setData({basketPulse:true});clearTimeout(this.basketTimer);this.basketTimer=setTimeout(()=>this.setData({basketPulse:false}),380);if(this.basketTimer.unref)this.basketTimer.unref();this.refresh();}
});},
undoSwipe(){
const last=this.swipeLast;if(!last||last.key!==this.queueKey())return;
if(last.kind==='pick'){
if(this.data.menuLocked||!this.data.cardReady){this.setData({error:'菜单已提交或开始制作，不能撤销这次选菜'});return;}
const fresh=service.state(),plan=fresh.plans[this.data.plan.key];
if(!plan||(last.after?signature(life.editable(plan,service.role()).lines)!==signature(last.after):plan.version!==last.version)){this.swipeLast=null;this.load();this.setData({error:'菜单已有其他改动，请在已选清单中调整'});return;}
return service.after(this.change('selectDraft',{lines:last.before}),()=>{if(this.data.error)return;this.swipeLast=null;this.setData({error:''});this.refresh();});
}else this.swipeQueues[last.key]=(this.swipeQueues[last.key]||[]).filter(id=>id!==last.id);
this.swipeLast=null;this.setData({error:''});wx.showToast({title:'已撤销上一步',icon:'none',duration:1800});this.refresh();
},
cardFavorite(){if(this.data.card)this.favorite({currentTarget:{dataset:{id:this.data.card.id}}});},
touchBegin(e){const t=e.touches&&e.touches[0];if(t)this.dragStart={x:t.clientX==null?t.pageX:t.clientX,y:t.clientY==null?t.pageY:t.clientY,id:this.data.card?.id};},
touchMove(e){const t=e.touches&&e.touches[0],start=this.dragStart;if(!t||!start)return;const dx=(t.clientX==null?t.pageX:t.clientX)-start.x,dy=(t.clientY==null?t.pageY:t.clientY)-start.y;this.dragDelta={dx,dy};if(Math.abs(dx)>Math.abs(dy)*1.3)this.setData({swipeStyle:'transform:translateX('+dx+'px);transition:none'});},
touchEnd(){const delta=this.dragDelta,start=this.dragStart;this.dragStart=null;this.dragDelta=null;this.setData({swipeStyle:''});if(!delta||start?.id!==this.data.card?.id)return;if(Math.abs(delta.dx)>=72&&Math.abs(delta.dx)>Math.abs(delta.dy)*1.3){if(delta.dx>0)this.previousDish();else this.nextDish();}},
touchCancel(){this.dragStart=null;this.dragDelta=null;this.setData({swipeStyle:''});}
};
}
module.exports={enhance};
