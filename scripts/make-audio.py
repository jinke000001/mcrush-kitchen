"""McRush: original 108 BPM / 16 bar composition, no samples or external music.
Renders exact-length loop stems. python3 scripts/make-audio.py (stdlib).
"""
import math, random, wave, struct
from pathlib import Path
SR=22050; BPM=108; BEAT=60/BPM; LENGTH=16*4*BEAT; N=round(LENGTH*SR)
ROOT=Path(__file__).resolve().parents[1]/'public/audio';ROOT.mkdir(parents=True,exist_ok=True)
rng=random.Random(20261011)
stems={k:[0.0]*N for k in ['warm','melody','groove']}
def freq(n):return 440*2**((n-69)/12)
def note(stem,midi,beat,duration,gain,voice='keys'):
    start=round(beat*BEAT*SR); count=round(duration*BEAT*SR); f=freq(midi)
    for j in range(count):
        t=j/SR; tail=max(0,1-j/max(1,count)); attack=min(1,t/.008)
        if voice=='bass':
            env=attack*math.exp(-2.0*t)*tail**.4
            val=math.sin(2*math.pi*f*t)+.12*math.sin(4*math.pi*f*t)
        elif voice=='bell':
            env=attack*math.exp(-3.8*t)*tail**.3
            val=math.sin(2*math.pi*f*t+.65*math.sin(2*math.pi*f*2*t)*math.exp(-7*t))+.05*math.sin(6*math.pi*f*t)
        else:
            env=attack*math.exp(-1.8*t)*tail**.5
            val=math.sin(2*math.pi*f*t+.25*math.sin(2*math.pi*f*2*t)*math.exp(-3*t))+.1*math.sin(4*math.pi*f*t)
        stems[stem][(start+j)%N]+=gain*val*env
# Fmaj7 — Am7 — Dm7 — Bbmaj7 — Gm7 — C9 — Fmaj7 — C7.
chords=[[53,57,60,64],[57,60,64,67],[50,53,57,60],[46,50,53,57],[43,46,50,53],[48,52,58,62],[53,57,60,64],[48,52,55,58]]*2
melodies=[ [72,69,67,69,76], [76,74,72,67,69], [69,72,77,76,72], [74,72,69,65,67], [70,69,67,62,65], [67,70,74,72,70], [69,72,76,77,76], [74,72,70,67,64], [72,76,77,76,72], [76,79,76,74,72], [77,76,72,69,72], [74,77,74,72,69], [70,74,77,74,70], [74,72,70,67,64], [69,72,76,72,69], [67,70,64,67,72] ]
for bar,chord in enumerate(chords):
    b=bar*4
    for shift in [0,2.5]:
        for i,n in enumerate(chord):note('warm',n+12,b+shift+i*.025,1.35,.07)
    for i,n in enumerate([chord[0]-12,chord[0],chord[0]-12,chord[2]-12]):note('warm',n,b+i, .8,.12,'bass')
    for i,(offset,dur) in enumerate([(0,.6),(.75,.6),(1.5,.9),(2.75,.4),(3.25,.6)]):note('melody',melodies[bar][i],b+offset,dur,.19,'bell')
    # Gentle shaker, brush/snare and kick; never harsh square waves.
    for beat in range(8):
        start=round((b+beat*.5)*BEAT*SR); last=0
        for j in range(round(.06*SR)):
            noise=rng.uniform(-1,1); high=noise-last;last=noise
            stems['groove'][(start+j)%N]+=.025*high*math.exp(-j/SR*60)
    for beat in [0,2]:
        start=round((b+beat)*BEAT*SR)
        for j in range(round(.17*SR)):
            t=j/SR;stems['groove'][(start+j)%N]+=.22*math.sin(2*math.pi*(49*t+3*(1-math.exp(-t*20))))*math.exp(-t*26)
    for beat in [1,3]:
        start=round((b+beat)*BEAT*SR);low=0
        for j in range(round(.13*SR)):
            low=low*.6+rng.uniform(-1,1)*.4
            stems['groove'][(start+j)%N]+=.06*low*math.exp(-j/SR*23)
for name,data in stems.items():
    dry=data[:]
    for delay,gain in [(.113,.12),(.229,.07)]:
        offset=round(delay*SR)
        for i,v in enumerate(dry):data[(i+offset)%N]+=v*gain
    peak=max(abs(v) for v in data)
    scale=min(1,.78/max(.0001,peak))
    with wave.open(str(ROOT/(name+'.wav')),'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(SR)
        f.writeframes(struct.pack('<'+'h'*N,*[round(max(-1,min(1,v*scale))*32767) for v in data]))
print('Original loop stems:', round(LENGTH,3), 'seconds each; 108 BPM, 16 bars')
