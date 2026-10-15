const cfg=require('./utils/config'),entry=require('./utils/notification-entry');
App({
 onLaunch(){if(wx.cloud&&cfg.env)wx.cloud.init({env:cfg.env,traceUser:true});},
 onShow(options){entry.receive(options);},
 onPageNotFound(){wx.switchTab({url:'/pages/v3-menu/index'});}
});
