const navigation=require('../utils/role-navigation');
const initialRole=wx.getStorageSync('rabbit-meals-role');
const initialItems=navigation.tabs(initialRole);
const initialPages=getCurrentPages(),initialPage=initialPages[initialPages.length-1];
const initialSelected=initialPage?initialPage.route.split('/')[1]:navigation.start(initialRole);
const initialHidden=!initialPage||!initialPage.data||initialPage.data.pageReady!==true||!!(initialPage.data.editing||initialPage.data.tip||initialPage.data.chooseRole);
Component({
 data:{items:initialItems,selected:initialSelected,selectedIndex:Math.max(0,initialItems.findIndex(i=>i.page===initialSelected)),hidden:initialHidden},
 lifetimes:{attached(){this._detached=false;this.sync();},detached(){this._detached=true;this._navigating=false;}},
 pageLifetimes:{show(){this.sync();}},
 methods:{
  sync(){
   const items=navigation.tabs(wx.getStorageSync('rabbit-meals-role'));
   const pages=getCurrentPages(),page=pages[pages.length-1];
   const selected=page?page.route.split('/')[1]:navigation.start(wx.getStorageSync('rabbit-meals-role'));
   const hidden=!page||!page.data||page.data.pageReady!==true||!!(page.data.editing||page.data.tip||page.data.chooseRole);
   const patch={};
   if(this.data.hidden!==hidden)patch.hidden=hidden;
   if(this.data.selected!==selected){patch.selected=selected;patch.selectedIndex=Math.max(0,items.findIndex(i=>i.page===selected));}
   if(JSON.stringify(this.data.items)!==JSON.stringify(items)){patch.items=items;patch.selectedIndex=Math.max(0,items.findIndex(i=>i.page===selected));}
   if(Object.keys(patch).length)this.setData(patch);
  },
  go(e){
   const page=e.currentTarget.dataset.page;
   if(this._navigating||page===this.data.selected)return;
   const index=this.data.items.findIndex(i=>i.page===page);
   if(index<0)return;
   this._navigating=true;
   // Keep the highlight on the visible page until the actual route changes.
   wx.switchTab({url:'/pages/'+page+'/index',fail:()=>{if(!this._detached)this.sync();},complete:()=>{this._navigating=false;}});
  }
 }
});
