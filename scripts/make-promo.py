"""Create original promo graphics and a 55-second trailer from real recorded gameplay.
Requires Pillow and FFmpeg. No generated gameplay or third-party music is used.
Usage: python scripts/make-promo.py --gameplay recording.webm
"""
import argparse, subprocess, shutil, json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

parser=argparse.ArgumentParser();parser.add_argument('--gameplay',type=Path,required=True);parser.add_argument('--font',type=Path,default=Path('/System/Library/Fonts/STHeiti Medium.ttc'));args=parser.parse_args()
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'output/promo';MEDIA=ROOT/'public/media';DOCS=ROOT/'docs/media'
for folder in [OUT,MEDIA,DOCS]:folder.mkdir(parents=True,exist_ok=True)
FF=shutil.which('ffmpeg');assert FF,'Install FFmpeg first';assert args.font.exists(),'Pass --font with a locally installed CJK font';assert args.gameplay.exists()
PAPER='#f9f1e2';RED='#b9402c';INK='#403a2c';GREEN='#304d47';GOLD='#efbb56'
def font(size):return ImageFont.truetype(str(args.font),size)
def text(draw,xy,value,size,fill=INK):draw.text(xy,value,font=font(size),fill=fill,spacing=14)
def run(options,name):
    with open(OUT/(name+'.log'),'w')as log:subprocess.run([FF,'-nostdin','-y',*map(str,options)],stdout=log,stderr=log,check=True)

for number,second in [(1,10),(2,47),(3,67)]:
    run(['-ss',second,'-i',args.gameplay,'-frames:v',1,OUT/f'shift-{number}.png'],f'extract-{number}')
    Image.open(OUT/f'shift-{number}.png').convert('RGB').resize((960,540),Image.Resampling.LANCZOS).save(MEDIA/f'shift-{number}.jpg',quality=87,optimize=True)
night=Image.open(ROOT/'docs/preview.png').convert('RGB')
kitchen=night.crop((220,80,1450,790))
ImageOps.fit(kitchen,(1280,900),method=Image.Resampling.LANCZOS).save(MEDIA/'hero.jpg',quality=90,optimize=True)

# Readme hero and repository / social link preview, from actual gameplay pixels.
hero=Image.new('RGB',(1280,640),PAPER);d=ImageDraw.Draw(hero)
d.rectangle((0,0,1280,10),fill=RED);d.rectangle((0,600,1280,640),fill=GREEN)
shot=ImageOps.fit(kitchen,(710,520),method=Image.Resampling.LANCZOS)
hero.paste(shot,(570,52));d=ImageDraw.Draw(hero)
d.rounded_rectangle((520,32,1264,588),radius=15,outline='#d5b98d',width=2)
d.rectangle((510,0,570,598),fill=PAPER)
text(d,(44,54),'McRush',60,RED);text(d,(47,130),'麦 门 厨 房',27)
text(d,(44,229),'一个人开店。',43);text(d,(44,290),'一起把这班接住。',43,RED)
text(d,(46,398),'单人操作 · 两位本地 AI 伙伴',19);text(d,(46,434),'三关可重玩 / 电脑浏览器打开即玩',18,'#92744c')
text(d,(46,531),'COOK. PASS. TOGETHER.',19,GREEN);text(d,(46,611),'原创实机画面   /   McRush · Kitchen Relay',14,'#fff1d3')
hero.save(MEDIA/'social.png',optimize=True);hero.save(DOCS/'hero.png',optimize=True);hero.save(MEDIA/'poster.jpg',quality=93,optimize=True)

# Intro/outro and transparent typography layers. Fonts are rasterized, not redistributed.
def card(name,lead,main,small,ending=False):
    im=Image.new('RGB',(1600,900),PAPER);d=ImageDraw.Draw(im)
    d.rectangle((0,0,1600,12),fill=RED);d.rectangle((0,822,1600,900),fill=GREEN)
    text(d,(84,67),'McRush',53,RED);text(d,(87,139),'麦门厨房 / COOK. PASS. TOGETHER.',19,'#90744d')
    text(d,(84,254),lead,37,GREEN);text(d,(78,323),main,86,RED)
    text(d,(86,470),small,25,INK)
    if ending:
        d.rounded_rectangle((84,585,1138,700),radius=9,fill=RED)
        text(d,(117,610),'mcrush-kitchen-jinke.netlify.app',39,'#fff1dc')
    else:
        text(d,(87,602),'亲手料理  /  指挥伙伴  /  救回一份订单',25,'#947953')
    text(d,(84,846),'真实游戏录像剪辑 · 原创配乐 · 非官方独立试玩作品',21,'#fff1dc')
    im.save(OUT/(name+'.png'))
card('intro','一个人，忙不过来？','那就一起接住。','一间厨房，三个伙伴。每一份热乎，都有你的接力。')
card('outro','McRush · 麦门厨房','今晚这一班，交给你。','电脑键鼠 · 无需账号 · 两位 AI 伙伴在浏览器本地运行',True)
chapters=[('01 / HANDS ON','先亲手，做好一份热乎。','拿取、煎炸、组装、出餐，你就是厨房的一员。',2,10),('02 / TEAMWORK','下一步，交给伙伴。','按 Q 指挥接续食物；伙伴会真正走来、拿起、继续料理。',18,16),('03 / LUNCH RUSH','三条生产线，一起准时。','传餐带连接热厨与配餐；满载会停，人工仍能绕行。',43,10),('04 / NIGHT SHIFT','认准窗口，接住新的高峰。','堂食与外带分流：判断优先级，重新安排分工。',62,10)]
segments=[]
for name,duration in [('intro',4)]:
    target=OUT/(name+'.mp4');run(['-loop',1,'-i',OUT/(name+'.png'),'-t',duration,'-r',30,'-an','-c:v','libx264','-threads',2,'-preset','veryfast','-crf',20,'-pix_fmt','yuv420p',target],name);segments.append(target)
for i,(label,title,detail,start,duration)in enumerate(chapters,1):
    layer=Image.new('RGBA',(1600,900),(0,0,0,0));d=ImageDraw.Draw(layer)
    d.rectangle((0,784,1600,900),fill=(38,60,55,248));d.rectangle((0,784,1600,788),fill=GOLD)
    text(d,(38,804),title,32,'#fff1d3');text(d,(40,854),detail,18,'#ccd6be')
    d.rounded_rectangle((1150,24,1564,71),radius=6,fill=(249,241,226,245));text(d,(1171,37),label,20,GREEN)
    layer.save(OUT/f'overlay-{i}.png');target=OUT/f'part-{i}.mp4'
    run(['-ss',start,'-t',duration,'-i',args.gameplay,'-loop',1,'-i',OUT/f'overlay-{i}.png','-filter_complex','[0:v]scale=1600:900,fps=30,setsar=1[v];[v][1:v]overlay=0:0:shortest=1,format=yuv420p[out]','-map','[out]','-an','-t',duration,'-c:v','libx264','-threads',2,'-preset','veryfast','-crf',22,target],f'part-{i}');segments.append(target)
target=OUT/'outro.mp4';run(['-loop',1,'-i',OUT/'outro.png','-t',5,'-r',30,'-an','-c:v','libx264','-threads',2,'-preset','veryfast','-crf',20,'-pix_fmt','yuv420p',target],'outro');segments.append(target)
(OUT/'concat.txt').write_text(''.join("file '"+p.name+"'\n"for p in segments))
run(['-f','concat','-safe',0,'-i',OUT/'concat.txt','-c','copy',OUT/'picture.mp4'],'concat')
run(['-i',OUT/'picture.mp4','-stream_loop',-1,'-i',ROOT/'public/audio/warm.wav','-stream_loop',-1,'-i',ROOT/'public/audio/melody.wav','-stream_loop',-1,'-i',ROOT/'public/audio/groove.wav','-filter_complex','[1:a][2:a][3:a]amix=inputs=3:weights=1 0.8 0.7:normalize=0,volume=0.65,afade=t=in:d=1,afade=t=out:st=52:d=3,alimiter=limit=0.85[a]','-map','0:v','-map','[a]','-t',55,'-c:v','copy','-c:a','aac','-b:a','160k','-ar',48000,'-movflags','+faststart',MEDIA/'mcrush-trailer.mp4'],'music')
(MEDIA/'trailer.zh.vtt').write_text('''WEBVTT

00:00.000 --> 00:04.000
一个人，忙不过来？那就一起接住。

00:04.000 --> 00:14.000
先亲手，做好一份热乎。拿取、煎炸、组装、出餐。

00:14.000 --> 00:30.000
下一步，交给伙伴。按 Q 指挥接续食物。

00:30.000 --> 00:40.000
三条生产线，一起准时。满载的传餐带会停，人工仍能绕行。

00:40.000 --> 00:50.000
认准窗口，接住新的高峰。堂食与外带分流。

00:50.000 --> 00:55.000
今晚这一班，交给你。电脑键鼠，无需账号，两位本地 AI 伙伴。
''')
(OUT/'timeline.json').write_text(json.dumps({'duration':55,'source':args.gameplay.name,'speed':1,'chapters':[{'label':c[0],'sourceStart':c[3],'seconds':c[4]}for c in chapters],'audio':'Original McRush warm/melody/groove stems, mixed for trailer; in-game SFX not captured','gameplay':'Real recorded keyboard input; editorial cuts and text overlays only'},ensure_ascii=False,indent=2))
print('Created 55-second trailer, original promo graphics and captions.')
