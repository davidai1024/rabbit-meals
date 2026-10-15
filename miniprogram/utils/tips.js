const actions={
 showTip(o){if(wx.hideToast)wx.hideToast();this._tipCallback=o.success;this.setData({tip:{title:o.title||'请留意',content:o.content||'',confirmText:o.confirmText||(o.success?'确认':'知道了'),cancelText:o.cancelText||'暂不操作',confirm:!!o.success}});},
 tipInfo(e){const d=e.currentTarget.dataset;this.showTip({title:d.title,content:d.content});},
 tipConfirm(){this._shownError='';const fn=this._tipCallback;this._tipCallback=null;this.setData({tip:null});if(fn)return fn({confirm:true,cancel:false});},
 tipDismiss(){this._shownError='';const fn=this._tipCallback;this._tipCallback=null;this.setData({tip:null});if(fn)return fn({confirm:false,cancel:true});}
};
function enhance(def){return {...def,data:{...def.data,tip:null},...actions,onLoad(o){const raw=this.setData;this.setData=function(v,done){raw.call(this,v,done);if(this.getTabBar&&['editing','tip','chooseRole'].some(k=>Object.prototype.hasOwnProperty.call(v,k))){const bar=this.getTabBar();if(bar&&bar.sync)bar.sync();}if(v.error&&v.error!==this._shownError){this._shownError=v.error;this.showTip({title:'需要处理一下',content:v.error});}else if(v.error==='')this._shownError='';};if(def.onLoad)return def.onLoad.call(this,o);}};}
module.exports={enhance,actions};
