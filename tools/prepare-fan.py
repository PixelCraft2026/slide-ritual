"""Stationary, periodic fan bed; no recorded room handling or slide transients."""
from pathlib import Path
import json,wave
import numpy as np

root=Path(__file__).resolve().parent.parent
rate=48000;seconds=8;n=rate*seconds
rng=np.random.default_rng(1502026)
freq=np.fft.rfftfreq(n,1/rate)
spectrum=np.fft.rfft(rng.normal(size=n))
shape=(freq/np.sqrt(freq**2+55**2))/np.sqrt(1+(freq/1700)**4)
shape[0]=0
noise=np.fft.irfft(spectrum*shape,n)
noise*=.045/np.sqrt(np.mean(noise**2))
# Exactly periodic weak motor partials; the broadband bed remains dominant.
t=np.arange(n)/rate
signal=noise+.003*np.sin(2*np.pi*96*t)+.001*np.sin(2*np.pi*192*t)
pcm=np.round(np.clip(signal,-1,1)*32767).astype('<i2')
with wave.open(str(root/'assets/fan.wav'),'wb') as wav:
    wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(rate);wav.writeframes(pcm.tobytes())
blocks=signal.reshape(-1,rate//4)
rms=np.sqrt(np.mean(blocks**2,axis=1))
report={'source':'deterministic stationary noise synthesized locally','sampleRate':rate,'duration':seconds,'seed':1502026,'rms':float(np.sqrt(np.mean(signal**2))),'peak':float(np.max(np.abs(signal))),'quarterSecondRmsCV':float(np.std(rms)/np.mean(rms)),'roomRecordingUsed':False}
assert report['quarterSecondRmsCV']<.04
(root/'qa').mkdir(parents=True,exist_ok=True)
(root/'qa/v22-fan-analysis.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,indent=2))
