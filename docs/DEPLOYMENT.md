# 部署你们自己的小饭桌

## 本机演示与双人同步

| 模式 | 配置 | 数据在哪里 | 场景 |
| --- | --- | --- | --- |
| 本机演示 | `config.js.env` 留空 | 当前设备本地存储 | 看界面、试角色、验证流程 |
| 微信云端 | 自己的 AppID + 云环境 | 自己的微信云开发 | 两部手机共享菜单、采购与点评 |

本机演示支持切换身份，但两部手机不会自动同步。

## 1. 导入正确的目录

微信开发者工具导入包含 `project.config.json` 的仓库根目录。项目配置已经设置：

```json
{"miniprogramRoot": "miniprogram/", "cloudfunctionRoot": "cloudfunctions/"}
```

`touristappid` 是公开占位值。按工具提供的测试账号流程导入，或换成自己的真实 AppID。云开发和两部手机体验需要使用自己的小程序账号。

## 2. 配置云环境与权限

在开发者工具开通自己的云环境，将环境 ID 填入 `miniprogram/utils/config.js` 的 `env`。

数据库创建三个集合：

| 集合 | 用途 |
| --- | --- |
| `mealFamilies` | 成员、菜品、菜单和业务状态 |
| `mealIdentities` | 微信身份与饭桌关联 |
| `mealNotifications` | 通知去重与发送状态 |

三个集合都设置为**客户端不可读写**。自定义规则示例：

```json
{"read": false, "write": false}
```

云存储同样保持客户端不能直接读写。照片由云函数校验成员、格式和大小后保存，再向成员签发临时读取地址。不要开放数据库或文件权限来排障。

## 3. 部署当前云函数

在 `cloudfunctions/planningFamily` 上右键，选择 **上传并部署：云端安装依赖**。依赖由该目录的 `package.json` 声明，客户端根目录不需要构建 npm。

当前业务函数名是 `planningFamily`。`cloudfunctions/family` 是兼容测试的历史实现，不是当前部署入口。

创建饭桌时自动初始化公开演示菜库，不需要导入原项目用户数据。

## 4. 加入同一张饭桌

1. 第一位成员打开小程序，进入两人共享设置并创建饭桌。
2. 复制 24 位十六进制邀请码，通过私密渠道给另一人。
3. 另一位使用自己的微信加入。同一饭桌最多两位成员。
4. 各自选择点餐者或大厨；两位成员均可切换身份。

开发 / 体验阶段，在微信后台为另一位配置体验权限，再使用体验版。入口为 `pages/v3-menu/index`。

## 5. 可选：微信订阅提醒

不开启提醒也能正常提交和点评。公开版没有绑定原账号模板。

在**自己的小程序账号**选择适合服务类目的模板，配置两处：

| 位置 | 内容 |
| --- | --- |
| 客户端 `config.js` | `notificationTemplates` 中 `menu`、`review` 对应的 `id` |
| `planningFamily` 云函数环境变量 | `MENU_TEMPLATE_ID`、`REVIEW_TEMPLATE_ID` |

当前发送字段：菜单提交使用 `name3`、`date4`、`thing7`；首次菜品点评使用 `time1`、`thing2`。选用不同字段的模板时，同步修改 `planningFamily/notifications.js`。`config.json` 已声明 `subscribeMessage.send` 权限。

大厨在手机进入 **头像 → 两人共享设置 → 饭桌提醒**，订阅两种提醒并在微信弹窗同意。一次性模板每次授权对应一次发送机会；保持选择不等于无限通知。

通知失败不撤销菜单和点评；接口受理不等于手机已收到，需要两部手机验证授权、送达与详情跳转。体验版默认打开 `trial`；正式版本设置云函数环境变量：

```text
MINIPROGRAM_STATE=formal
```

参考：[微信订阅消息 API](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/wx.requestSubscribeMessage.html)、[微信云开发入门](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)。

## 浏览器辅助预览

仓库根目录运行：

```bash
python3 -m http.server 8766 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8766/preview/index.html`。预览使用本机模拟数据，可切两种身份，演示 7 个业务页面；饭桌绑定、微信授权、云端同步、订阅消息和真机触摸表现仍需微信环境。

## 发布前验收

- 两个人能加入同一饭桌，第三位无法加入或读取。
- 点餐者提交后，另一部手机看到同一菜单。
- 挑新菜只改草稿；取消替换不改原单，确认替换后重新接单。
- 相同内容重提保留接单进度；任意一道做好后不能换菜。
- 采购、做好、点评和「下次还想吃」在另一端可见。
- 窄屏、弹层、列表、首次连接失败与重试正常。
- 提醒完成主动授权、真实送达与详情跳转。

客户端 `config.js.testToolsEnabled` 和服务端 `planningFamily/test-tools.js.enabled` 默认为 `false`，正式发布保持关闭。若曾打开，关闭后重新部署云函数并上传客户端。

最后按微信后台要求完成隐私、类目、备案、体验成员、审核和发布。云资源套餐与审核结果由平台决定，本仓库不承诺免费额度或免资质。
