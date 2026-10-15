#!/usr/bin/env python3
"""Generate the repository's original, dependency-free SVG artwork.

Copyright (c) 2026 rabbit-meals contributors. MIT License.
All shapes below are drawn for this open-source edition. No external images,
fonts, icon packages or screenshots are embedded in the generated artwork.
"""
from pathlib import Path
import json, math, re, html

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'miniprogram/assets'
DOCS=ROOT/'docs/images'
INK='#3f3d35'; MUTED='#77786a'; RED='#cf4f3c'; GREEN='#728368'; CREAM='#fff9ef'; LINE='#e7e4d8'
FONT="-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif"

def svg(w,h,body,title=''):
 return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{html.escape(title)}"><title>{html.escape(title)}</title><g font-family="{FONT}">{body}</g></svg>\n'
def rect(x,y,w,h,fill,rx=0,stroke='none',sw=1):
 return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'
def circle(x,y,r,fill,stroke='none',sw=1):
 return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'
def ellipse(x,y,rx,ry,fill,rot=0):
 return f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="{fill}" transform="rotate({rot} {x} {y})"/>'
def text(x,y,s,size=24,color=INK,weight=400,anchor='start'):
 return f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{html.escape(str(s))}</text>'
def path(d,fill='none',stroke=INK,sw=3):
 return f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'
def group(x,y,s,body): return f'<g transform="translate({x} {y}) scale({s})">{body}</g>'
def heart(x,y,s=1,color=RED):
 return group(x,y,s,path('M0 8C-18-8-25 5-16 15L0 29L16 15C25 5 18-8 0 8Z',color,'none'))
def leaf(x,y,s=1,rot=0):
 return f'<g transform="translate({x} {y}) rotate({rot}) scale({s})">'+path('M0 0C-28-52 32-67 48-77C48-35 32-4 0 0Z',GREEN,'none')+path('M0 0L38-60','none','#cedbb4',3)+'</g>'
def bowl(x,y,s=1):
 return group(x,y,s,ellipse(0,0,66,15,'#fffdf6')+path('M-66 0Q-58 65 0 67Q58 65 66 0Z','#fffdf6',INK,3)+path('M-49 20Q0 35 49 20','none',RED,5)+rect(-22,67,44,9,INK,4))
def rabbit():
 b=ellipse(0,150,82,14,'#d7d2bf')
 b+=ellipse(-35,-63,21,78,RED,-13)+ellipse(34,-63,21,78,RED,13)
 b+=ellipse(-35,-65,8,53,'#f6b89b',-13)+ellipse(34,-65,8,53,'#f6b89b',13)
 b+=ellipse(0,83,66,68,RED)+ellipse(0,110,43,36,'#fff1db')
 b+=ellipse(0,0,76,65,RED)+ellipse(0,25,46,29,'#fff1db')
 b+=ellipse(-25,0,7,10,INK)+ellipse(25,0,7,10,INK)+circle(-23,-3,2,'#fff')+circle(27,-3,2,'#fff')
 b+=path('M-7 14Q0 8 7 14Q6 23 0 24Q-6 23-7 14Z',INK,'none')
 b+=path('M0 24V31M0 31Q-10 38-17 29M0 31Q10 38 17 29','none',INK,3)
 b+=ellipse(-43,22,12,6,'#f39579')+ellipse(43,22,12,6,'#f39579')
 b+=bowl(0,75,.8)
 b+=ellipse(-51,83,19,11,RED,-24)+ellipse(51,83,19,11,RED,24)
 b+=ellipse(-32,142,27,15,RED)+ellipse(32,142,27,15,RED)
 return b

def veggies():
 b=leaf(20,80,.7,-23)+leaf(51,80,.65,20)+leaf(44,90,.55,-60)
 b+=path('M0 80Q43 50 75 83L11 157Q-2 172-5 153Z','#e8904e','none')
 b+=path('M12 94L35 98M5 113L22 117M0 132L9 135','none','#c56b33',4)
 b+=ellipse(112,122,47,36,'#cf4f3c')+path('M105 83L112 100L132 92L121 107L106 106L93 92Z',GREEN,'none')
 b+=leaf(175,156,.95,15)
 return b

def dish(kind='meat',label='',w=480,h=360):
 b=rect(0,0,w,h,'#f2eee2',28)+ellipse(w/2,h*.57,w*.36,h*.24,'#dedbcc')
 b+=ellipse(w/2,h*.5,w*.36,h*.27,'#fffcf4')+ellipse(w/2,h*.5,w*.29,h*.21,'#e7e7d6')
 cx=w/2;cy=h*.5
 for i in range(16):
  angle=i*2.399963;rad=14+17*(i%5);x=cx+math.cos(angle)*rad;y=cy+math.sin(angle)*rad*.55
  if kind=='egg':
   b+=ellipse(x,y,27,16,'#edbb53',i*29)+path(f'M{x-18} {y-5}L{x+15} {y-15}L{x+22} {y+13}L{x-12} {y+18}Z','#ce6245','none')
  elif kind=='veg':
   b+=ellipse(x,y,33,13,'#6e8d57',i*43)+ellipse(x-4,y-3,16,7,'#a0ad69',i*43)
  elif kind=='tofu':
   b+=f'<g transform="rotate({i*17} {x} {y})">'+rect(x-23,y-16,46,32,'#d3a15d',5)+rect(x-18,y-12,36,24,'#f4d7a0',3)+'</g>'
  elif kind=='shrimp':
   b+=path(f'M{x-20} {y+12}C{x-44} {y-18} {x+27} {y-34} {x+28} {y-4}Q{x+22} {y+18} {x+3} {y+14}','none','#d8784c',14)
  elif kind=='soup':
   if i==0:b+=ellipse(cx,cy,w*.27,h*.19,'#d3b466')
   b+=ellipse(x,y,25,13,'#e7ca79',i*17)+rect(x-9,y-6,18,12,'#c88652',3)
  else:
   b+=f'<g transform="rotate({i*19} {x} {y})">'+rect(x-26,y-12,52,24,'#ae6c46',8)+path(f'M{x-19} {y-2}L{x+20} {y-2}','none','#d99864',3)+'</g>'
  if i%3==0:b+=ellipse(x+15,y+3,18,6,'#5b7c4f',i*37)
 if label:b+=text(w/2,h-24,label,21,MUTED,500,'middle')
 return b

def scene(kind):
 w=1200;h=797;b=rect(0,0,w,h,'#f5dec0' if kind=='prep' else '#e3e9d3',36)
 b+=circle(1090,120,250,'#ffffff40')+circle(35,760,220,'#ffffff30')
 if kind=='prep':
  b+=rect(690,178,376,20,'#d4b08d',8)+group(880,174,.65,veggies())
  b+=group(865,430,1.25,rabbit())+rect(500,640,640,30,'#bda382',12)
  b+=group(588,574,.9,dish('veg','',230,145))+group(890,593,.75,dish('egg','',230,145))
  b+=rect(520,656,270,20,'#d78b52',10)+rect(807,656,270,20,'#d78b52',10)
 else:
  b+=group(730,388,.96,rabbit())+group(990,388,.96,rabbit())
  b+=ellipse(864,647,279,80,'#c7a97e')+ellipse(864,631,279,80,'#fff8e6')
  b+=bowl(864,595,1.12)+group(1035,620,.44,dish('veg','',250,180))
  b+=leaf(95,740,2,15)+leaf(79,630,1.55,-20)+leaf(35,495,1.15,17)
 return svg(w,h,b,'备餐插画' if kind=='prep' else '周末双人餐桌插画')

def icon_shape(name,color):
 p=lambda d:path(d,'none',color,1.8)
 if 'favorite-heart' in name or name.startswith('heart'):
  return path('M12 20L3.4 11.8C-2 5.5 5.6-1.4 12 5.5C18.4-1.4 26 5.5 20.6 11.8Z',color if 'filled' in name else 'none',color,1.8)
 if 'view-list' in name:return p('M8 6H21M8 12H21M8 18H21')+circle(3,6,1.4,color)+circle(3,12,1.4,color)+circle(3,18,1.4,color)
 if 'view-card' in name:return rect(4,2,16,20,'none',3,color,1.8)+p('M5 15H19M8 18H16')
 if 'cook' in name:return path('M6 13C0 13 0 5 6 5C8-1 16-1 18 5C24 5 24 13 18 13V22H6Z','none',color,1.8)+p('M7 17H17')
 if 'guest' in name:return circle(12,5,3.6,'none',color,1.8)+p('M4 21V18C4 10 20 10 20 18V21')
 if 'calendar' in name:return rect(3,4,18,18,'none',3,color,1.8)+p('M3 10H21M7 2V6M17 2V6M7 14H9M14 14H16M7 18H9')
 if 'leaf' in name:return path('M4 21C-1 7 14 5 21 2C22 16 18 22 4 21Z','none',color,1.8)+p('M4 21L17 8')
 if 'check' in name:return circle(12,12,9,'none',color,1.8)+p('M7 12L11 16L18 8')
 if 'star' in name:return path('M12 2L15 8L22 9L17 14L18 21L12 18L6 21L7 14L2 9L9 8Z',color if 'solid' in name else 'none',color,1.6)
 if 'stats' in name:return rect(3,13,4,9,color,2)+rect(10,7,4,15,color,2)+rect(17,2,4,20,color,2)
 if 'library' in name:return rect(3,3,5,18,'none',1,color,1.8)+rect(10,3,5,18,'none',1,color,1.8)+path('M17 4L20 3L23 20L20 21Z','none',color,1.8)
 if 'shop' in name:return path('M3 8H21L19 22H5Z','none',color,1.8)+p('M7 9L10 2M17 9L14 2M9 12V18M15 12V18')
 if 'plate' in name:return circle(12,12,7,'none',color,1.8)+p('M2 3V21M22 3V21')
 return rect(5,3,14,19,'none',3,color,1.8)+p('M9 8H15M9 12H15M9 16H15')

def chip(x,y,label,w):
 return rect(x,y,w,44,'#fffdf5',22,LINE)+text(x+w/2,y+29,label,19,INK,500,'middle')
def cover():
 b=rect(0,0,1600,700,CREAM,36)+circle(1454,85,330,'#e7ebda')+circle(1480,700,290,'#f1dbba')
 b+=text(96,108,'RABBIT MEALS  /  OPEN SOURCE',21,GREEN,600)
 b+=text(90,232,'兔子吃饭了',88,INK,650)+text(94,302,'两个人，一张共享饭桌',35,RED,500)
 b+=text(96,380,'把“今天吃什么”，变成一起期待的小事。',25,MUTED)
 b+=chip(96,448,'点菜 · 备餐',156)+chip(268,448,'双人云端同步',188)+chip(472,448,'微信原生小程序',206)
 b+=path('M96 556H736','none',LINE,2)+text(96,603,'挑喜欢的菜  /  一起定菜单  /  好好吃一顿',24,GREEN,500)
 b+=ellipse(1200,594,310,42,'#dedbc7')+group(1168,345,1.55,rabbit())
 b+=group(1450,470,.62,veggies())+heart(1424,194,.8)+heart(1000,260,.44,'#d5b18c')
 b+=path('M963 490Q915 441 957 405','none',GREEN,4)+path('M958 405L950 427M958 405L977 420','none',GREEN,4)
 b+=text(1512,660,'原创矢量插画',16,MUTED,400,'end')
 return svg(1600,700,b,'兔子吃饭了：两个人，一张共享饭桌。微信原生开源小程序。')

def tile_frame(x,y,n,title,subtitle,body):
 b=rect(x,y,464,430,'#fffefa',28,LINE,1.5)+circle(x+36,y+40,15,'#f6e4d7')+text(x+36,y+46,n,15,RED,600,'middle')
 b+=text(x+62,y+49,title,25,INK,650)+text(x+25,y+92,subtitle,17,MUTED)
 b+=group(x+24,y+120,1,body)
 return b

def feature_board():
 b=rect(0,0,1600,1120,CREAM,32)+text(72,84,'两种身份，一起把饭桌照顾好',42,INK,650)
 b+=text(72,125,'功能界面示意 · 使用虚构演示内容，非真机截图',21,MUTED)
 # 1. Pick dishes: illustration, recipe title and a right-aligned action.
 c=rect(0,0,416,259,'#f6f3e9',18)+group(15,16,.52,dish('egg','',360,240))
 c+=text(221,56,'番茄炒蛋',24,INK,600)+text(221,90,'酸甜 · 家常味',17,MUTED)
 c+=rect(221,123,164,46,RED,23)+text(303,153,'＋ 选这道',19,'#fff',600,'middle')
 c+=path('M20 198H396','none',LINE,1)+text(20,231,'卡片浏览 / 列表挑选',18,GREEN,500)
 b+=tile_frame(72,169,'01','按喜好点菜','点餐者 · 卡片与列表随手切换',c)
 # 2. Menus.
 c=rect(0,0,416,259,'#f1e0c1',18)+text(23,36,'下周的饭',24,INK,600)
 c+=chip(259,14,'待大厨确认',136)+text(23,79,'3 道荤菜  +  3 道素菜',20,RED,500)
 c+=rect(23,102,370,1,'#d8c9ae')
 for yy,xx,lab in [(143,23,'青椒肉丝'),(143,213,'香菇牛肉'),(191,23,'番茄炒蛋'),(191,213,'清炒西兰花')]:
  c+=circle(xx+8,yy-6,5,GREEN)+text(xx+24,yy,lab,18,INK)
 c+=text(23,237,'另有周末餐单，可按日期与餐次安排',17,MUTED)
 b+=tile_frame(568,169,'02','把一周菜单定下来','双人共享 · 下周备餐与周末餐单',c)
 # 3. Procurement.
 c=rect(0,0,416,259,'#f5f6ee',18)
 for yy,name,qty,done in [(46,'番茄','600 克',False),(103,'鸡蛋','4 个',True),(160,'西兰花','600 克',False)]:
  c+=rect(18,yy-22,22,22,'#e4eadb' if done else '#fff',6,GREEN)
  if done:c+=path(f'M23 {yy-11}L28 {yy-6}L35 {yy-16}','none',GREEN,2)
  c+=text(56,yy-3,name,20,INK,500)+text(390,yy-3,qty,19,MUTED,400,'end')
  c+=path(f'M18 {yy+17}H398','none',LINE,1)
 c+=text(18,227,'同类食材合并 · 一键标记买好',17,GREEN,500)
 b+=tile_frame(1064,169,'03','买菜有一张清单就够','大厨 · 汇总食材，标记备齐状态',c)
 # 4. Cook.
 c=rect(0,0,416,259,'#f5f6ee',18)+text(20,42,'今天做好了 2 / 3 道',23,INK,600)
 c+=rect(20,63,376,9,'#e0e4d7',4)+rect(20,63,251,9,GREEN,4)
 for yy,name,done in [(116,'青椒肉丝',True),(169,'番茄炒蛋',True),(222,'清炒四季豆',False)]:
  c+=text(20,yy,name,20,INK)+rect(281,yy-28,115,39,'#e3eadb' if done else RED,19)
  c+=text(338,yy-3,'✓ 已做好' if done else '做好了',17,GREEN if done else '#fff',500,'middle')
 b+=tile_frame(72,627,'04','做一道，记一道','大厨 · 确认后逐道安排制作',c)
 # 5. Review.
 c=rect(0,0,416,259,'#f8eee3',18)+text(20,43,'这顿饭，吃得怎么样？',23,INK,600)
 c+=rect(20,65,110,39,'#fffaf2',19,LINE)+text(75,91,'吃完了',17,GREEN,500,'middle')
 c+=rect(144,65,110,39,'#fffaf2',19,LINE)+text(199,91,'有剩余',17,MUTED,400,'middle')
 c+=rect(268,65,126,39,'#fffaf2',19,LINE)+text(331,91,'不够吃',17,MUTED,400,'middle')
 c+=heart(57,142,.8)+text(106,164,'下次还想吃',25,RED,600)+text(20,218,'“今天的味道刚刚好，下次继续！”',18,MUTED)
 b+=tile_frame(568,627,'05','把喜欢告诉大厨','点餐者 · 每道做过的菜都能留点评',c)
 # 6. Pair.
 c=rect(0,0,416,259,'#f0f3e8',18)+circle(106,77,40,'#fae6d4')+circle(310,77,40,'#e0e8d5')
 c+=group(85,56,1.7,icon_shape('guest',RED))+group(290,56,1.7,icon_shape('cook',GREEN))
 c+=path('M164 77H252M240 68L252 77L240 86','none',GREEN,3)
 c+=text(106,147,'点餐者',22,INK,600,'middle')+text(310,147,'大厨',22,INK,600,'middle')
 c+=text(208,196,'邀请码加入同一张饭桌',20,GREEN,500,'middle')+text(208,231,'两位成员 · 角色可切换 · 云端同步',17,MUTED,400,'middle')
 b+=tile_frame(1064,627,'06','两个人，在同一张饭桌','独立微信身份 · 同享菜单和制作进度',c)
 b+=text(1528,1091,'所有插图与排版均由本项目代码生成',16,MUTED,400,'end')
 return svg(1600,1120,b,'功能界面示意：点菜、菜单、采购、制作、点评与双人共享。')

def workflow():
 b=rect(0,0,1600,1050,CREAM,32)+text(72,82,'两个人的饭桌，怎样运转？',42,INK,650)
 b+=text(72,124,'8 个步骤串起一餐，从加入到下一次期待',22,MUTED)
 steps=[('创建饭桌','任意一位成员','建立自己的共享空间'),('邀请加入','另一位成员','输入邀请码，最多两人'),('挑选菜品','点餐者','下周菜单 3 荤 + 3 素'),('提交菜单','点餐者','保存后等待大厨确认'),('确认菜单','大厨','核对菜品，再安排制作'),('采购与制作','大厨','合并买菜清单，逐道做好'),('用餐与点评','点餐者','记录实际结果和下次心愿'),('查看历史','两位成员','保留记录，复用到本期草稿')]
 pts=[]
 for i,(t,role,sub) in enumerate(steps):
  col=i%4;row=i//4;x=72+col*375;y=180+row*280
  pts.append((x,y))
  b+=rect(x,y,332,228,'#fffefa',24,LINE,1.5)+circle(x+36,y+39,19,RED if i in [2,3,6] else GREEN)
  b+=text(x+36,y+46,str(i+1),19,'#fff',650,'middle')+text(x+68,y+47,t,25,INK,600)
  b+=text(x+26,y+109,role,19,RED if i in [2,3,6] else GREEN,500)
  b+=text(x+26,y+155,sub,17,MUTED)
  b+=path(f'M{x+26} {y+185}H{x+304}','none',LINE,1)
  b+=text(x+26,y+210,'云端共享 · 由当前微信身份操作',15,MUTED)
  if col<3:b+=path(f'M{x+344} {y+112}H{x+363}M{x+356} {y+105}L{x+363} {y+112}L{x+356} {y+119}','none',GREEN,2.5)
 # connect top fourth to bottom first through gap, not through boxes.
 b+=path('M1524 292H1544V433H52V572H60M53 565L60 572L53 579','none',GREEN,2.5)
 b+=rect(72,768,1457,208,'#e9eddf',24)
 b+=text(104,814,'修改、确认与锁定规则',27,GREEN,650)
 b+=text(104,859,'尚无菜品做好时：大厨可提议调整，点餐者修改后重新提交，原确认状态随之更新。',22,INK)
 b+=text(104,901,'任意一道做好后：菜单锁定，不能直接改菜；制作记录与点评按对应菜单保留。',22,INK)
 b+=text(104,943,'微信提醒：对方已主动订阅且权限有效时尝试发送，提醒故障不影响菜单保存。',21,MUTED)
 b+=text(1528,1016,'流程示意 · 与生产微信环境、模板及两部手机联调结果分别验证',16,MUTED,400,'end')
 return svg(1600,1050,b,'两人协作8步流程，以及菜单修改、重新确认与制作锁定规则。')

def main():
 ASSETS.mkdir(parents=True,exist_ok=True);DOCS.mkdir(parents=True,exist_ok=True)
 # Rewrite all legacy icons in place with independently constructed geometry.
 for p in sorted(ASSETS.glob('*.svg')):
  if p.stem.startswith(('demo-', 'rabbit-', 'menu-prep', 'menu-weekend', 'review-supper')) or p.stem in ['decor','kitchen']: continue
  c=RED if 'coral' in p.name else '#5680a8' if 'blue' in p.name else '#b9924c' if 'gold' in p.name else MUTED
  p.write_text(svg(24,24,icon_shape(p.name,c),p.stem.replace('-',' ')))
 named={'demo-tomato-egg':'egg','demo-broccoli':'veg','demo-potato-chicken':'meat','demo-cucumber':'veg','demo-pepper-pork':'meat','demo-braised-pork':'meat','demo-mushroom-beef':'meat','demo-green-beans':'veg','demo-meat':'meat','demo-veg':'veg','demo-shrimp':'shrimp','demo-egg':'egg','demo-tofu':'tofu','demo-soup':'soup'}
 for n,k in named.items(): (ASSETS/(n+'.svg')).write_text(svg(480,360,dish(k,'演示菜品 · 原创插画'), '原创餐盘插画'))
 (ASSETS/'rabbit-avatar.svg').write_text(svg(240,240,rect(0,0,240,240,CREAM,48)+group(120,111,.72,rabbit()),'抱着饭碗的兔子'))
 (ASSETS/'menu-prep.svg').write_text(scene('prep'))
 (ASSETS/'menu-weekend.svg').write_text(scene('weekend'))
 (ASSETS/'review-supper.svg').write_text(svg(360,360,rect(0,0,360,360,CREAM,36)+group(180,176,.9,rabbit())+heart(306,94,.7)+heart(61,176,.42),'饭后点评的兔子'))
 (ASSETS/'decor.svg').write_text(svg(240,180,group(26,3,.9,veggies()),'蔬菜与番茄'))
 (ASSETS/'kitchen.svg').write_text(svg(600,398,rect(0,0,600,398,CREAM,30)+group(350,197,.82,rabbit())+rect(174,333,364,17,'#d5ba96',8)+group(172,291,.45,veggies()),'准备晚餐的小厨房'))
 mapping={}
 mp=DOCS/'asset-map.json'
 prior_mapping=json.loads(mp.read_text()) if mp.exists() else {}
 for p in sorted(ASSETS.rglob('*')):
  if p.suffix.lower() not in ['.jpg','.jpeg','.png','.webp','.gif']:continue
  # A committed map limits cleanup to known legacy files on regeneration.
  if prior_mapping and '/assets/'+p.relative_to(ASSETS).as_posix() not in prior_mapping: continue
  n=p.stem
  if n in ['rabbit-avatar','menu-prep','menu-weekend','review-supper','decor','kitchen']:to=f'/assets/{n}.svg'
  elif any(x in n for x in ['shrimp']):to='/assets/demo-shrimp.svg'
  elif any(x in n for x in ['tofu']):to='/assets/demo-tofu.svg'
  elif any(x in n for x in ['soup']):to='/assets/demo-soup.svg'
  elif any(x in n for x in ['tomato-egg']):to='/assets/demo-tomato-egg.svg'
  elif n in named:to='/assets/'+n+'.svg'
  elif n in ['broccoli','cucumber','pepper-pork','braised-pork','potato-chicken']:to='/assets/demo-'+n+'.svg'
  elif any(x in n for x in ['bean','bok','cabbage','okra','amaranth','lotus','tip','lettuce','radish']):to='/assets/demo-veg.svg'
  else:to='/assets/demo-meat.svg'
  mapping['/assets/'+p.relative_to(ASSETS).as_posix()]=to
  p.unlink()
 # Preserve the map on regeneration after originals have already been removed.
 if prior_mapping:mapping={**prior_mapping,**mapping}
 mp.write_text(json.dumps(mapping,ensure_ascii=False,indent=2)+'\n')
 (DOCS/'cover.svg').write_text(cover())
 (DOCS/'features.svg').write_text(feature_board())
 (DOCS/'workflow.svg').write_text(workflow())
 print(f'Generated {len(list(ASSETS.glob("*.svg")))} original asset SVGs; mapped {len(mapping)} removed bitmaps; 3 README figures.')

if __name__=='__main__':main()
