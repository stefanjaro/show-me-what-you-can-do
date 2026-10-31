// Procedural ambient audio for AETHER
window.AETHER = window.AETHER || {};
(function(){
  let ctx=null, master=null, reverb=null, windGain=null, musicGain=null;
  let running=false, timer=null, nextTime=0, beat=0;
  const scale=[0,3,5,7,10,12,15,17,19,22]; // minor pentatonic-ish semitones
  const root=55; // A1

  function makeImpulse(seconds, decay){
    const sr=ctx.sampleRate;
    const len=Math.floor(sr*seconds);
    const buf=ctx.createBuffer(2,len,sr);
    for(let c=0;c<2;c++){
      const d=buf.getChannelData(c);
      for(let i=0;i<len;i++){
        d[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay);
      }
    }
    return buf;
  }

  function ensure(){
    if(ctx) return;
    ctx=new (window.AudioContext||window.webkitAudioContext)();
    master=ctx.createGain(); master.gain.value=0.6; master.connect(ctx.destination);
    // reverb
    const conv=ctx.createConvolver();
    conv.buffer=makeImpulse(2.6,3.0);
    const wet=ctx.createGain(); wet.gain.value=0.35;
    conv.connect(wet); wet.connect(master);
    reverb=conv;
    // music bus
    musicGain=ctx.createGain(); musicGain.gain.value=0.35;
    musicGain.connect(master); musicGain.connect(conv);
    // wind
    const bufSize=2*ctx.sampleRate;
    const noiseBuf=ctx.createBuffer(1,bufSize,ctx.sampleRate);
    const nd=noiseBuf.getChannelData(0);
    for(let i=0;i<bufSize;i++) nd[i]=Math.random()*2-1;
    const src=ctx.createBufferSource(); src.buffer=noiseBuf; src.loop=true;
    const filt=ctx.createBiquadFilter(); filt.type='lowpass'; filt.frequency.value=400; filt.Q.value=0.7;
    windGain=ctx.createGain(); windGain.gain.value=0.08;
    src.connect(filt); filt.connect(windGain); windGain.connect(master);
    src.start();
    // store
    window.AETHER._audio={ctx,master,musicGain,conv};
  }

  function playNote(time, freq, dur, gain){
    const o=ctx.createOscillator();
    const g=ctx.createGain();
    o.type='sine';
    o.frequency.value=freq;
    g.gain.setValueAtTime(0,time);
    g.gain.linearRampToValueAtTime(gain,time+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,time+dur);
    o.connect(g); g.connect(musicGain);
    o.start(time); o.stop(time+dur+0.1);
    // overtone
    const o2=ctx.createOscillator(); const g2=ctx.createGain();
    o2.type='triangle'; o2.frequency.value=freq*2.0;
    g2.gain.setValueAtTime(0,time);
    g2.gain.linearRampToValueAtTime(gain*0.15,time+0.02);
    g2.gain.exponentialRampToValueAtTime(0.0001,time+dur*0.6);
    o2.connect(g2); g2.connect(musicGain);
    o2.start(time); o2.stop(time+dur+0.1);
  }

  function schedule(){
    if(!running) return;
    const lookahead=0.2;
    while(nextTime < ctx.currentTime+lookahead){
      const stepDur=0.45;
      // occasionally play a note
      if(Math.random()<0.55){
        const deg=scale[Math.floor(Math.random()*scale.length)];
        const oct=Math.random()<0.3?2:1;
        const freq=root*Math.pow(2,(deg+12*oct)/12);
        playNote(nextTime, freq, stepDur*1.6, 0.25);
      }
      // bass drone every 4 beats
      if(beat%8===0){
        playNote(nextTime, root*0.5, stepDur*4, 0.12);
      }
      nextTime+=stepDur;
      beat++;
    }
    timer=setTimeout(schedule,50);
  }

  window.AETHER.audio={
    start(){ ensure(); if(ctx.state==='suspended') ctx.resume(); if(running) return; running=true; nextTime=ctx.currentTime+0.1; beat=0; schedule(); },
    stop(){ running=false; if(timer) clearTimeout(timer); },
    toggle(){ if(running){ this.stop(); } else { this.start(); } return running; },
    isRunning(){ return running; },
    setVolume(v){ if(master) master.gain.value=v; },
    setMusic(v){ if(musicGain) musicGain.gain.value=v; },
    setWind(v){ if(windGain) windGain.gain.value=v; }
  };
})();
