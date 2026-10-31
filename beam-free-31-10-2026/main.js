// AETHER main application
(function(){
  const A = window.AETHER;
  const canvas = document.getElementById('gl');
  const gl = canvas.getContext('webgl2', { antialias:false, alpha:false, powerPreference:'high-performance' });
  if(!gl){ document.body.innerHTML='<div style="color:#fff;padding:2rem;font-family:system-ui">WebGL2 not supported.</div>'; return; }

  // ---------- expression parser / transpiler ----------
  function tokenize(s){
    const toks=[]; let i=0;
    while(i<s.length){
      const c=s[i];
      if(/\s/.test(c)){ i++; continue; }
      if(/[0-9.]/.test(c)){
        let j=i;
        while(j<s.length && /[0-9.]/.test(s[j])) j++;
        if(j<s.length && (s[j]==='e'||s[j]==='E')){
          j++;
          if(j<s.length && (s[j]==='+'||s[j]==='-')) j++;
          while(j<s.length && /[0-9]/.test(s[j])) j++;
        }
        toks.push({t:'num',v:s.slice(i,j)}); i=j; continue;
      }
      if(/[a-zA-Z_]/.test(c)){
        let j=i;
        while(j<s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
        toks.push({t:'id',v:s.slice(i,j)}); i=j; continue;
      }
      if('+-*/^%(),'.includes(c)){ toks.push({t:'op',v:c}); i++; continue; }
      throw new Error('Unexpected character: '+c);
    }
    return toks;
  }

  // recursive descent
  function Parser(tokens){
    let pos=0;
    const peek=()=>tokens[pos];
    const next=()=>tokens[pos++];
    function parse(){ const e=expr(); if(pos<tokens.length) throw new Error('Unexpected token '+ (tokens[pos].v)); return e; }
    function expr(){ let n=term(); while(peek() && (peek().v==='+'||peek().v==='-') && peek().t==='op'){ const op=next().v; const r=term(); n=`(${n}${op}${r})`; } return n; }
    function term(){ let n=power(); while(peek() && (peek().v==='*'||peek().v==='/'||peek().v==='%') && peek().t==='op'){ const op=next().v; const r=power(); n=`(${n}${op==='%'?'mod('+n+','+r+')':op+r})`; if(op==='%') n=`mod(${n.split('mod(')[0]})`? n : n; } 
      // fix modulo handling above is messy; redo cleanly below by restructure
      return n;
    }
    // We'll override term below
    return {parse};
  }

  // Rewrite parser cleanly:
  function makeParser(tokens){
    let pos=0;
    const peek=()=>tokens[pos];
    const next=()=>tokens[pos++];
    function parse(){ const e=expr(); if(pos<tokens.length) throw new Error('Unexpected token "'+tokens[pos].v+'"'); return e; }
    function expr(){ let n=term(); while(peek() && peek().t==='op' && (peek().v==='+'||peek().v==='-')){ const op=next().v; const r=term(); n=`(${n}${op}${r})`; } return n; }
    function term(){ let n=power(); while(peek() && peek().t==='op' && (peek().v==='*'||peek().v==='/'||peek().v==='%')){ const op=next().v; const r=power(); if(op==='%') n=`mod(${n},${r})`; else n=`(${n}${op}${r})`; } return n; }
    function power(){ let n=unary(); if(peek() && peek().t==='op' && peek().v==='^'){ next(); const r=power(); n=`pow(${n},${r})`; } return n; }
    function unary(){ if(peek() && peek().t==='op' && (peek().v==='-'||peek().v==='+')){ const op=next().v; const n=unary(); return op==='-'?`(-${n})`:`(${n})`; } return primary(); }
    function primary(){
      const t=peek();
      if(!t) throw new Error('Unexpected end of expression');
      if(t.t==='num'){
        next();
        let v=t.v;
        if(!/[.eE]/.test(v)) v+='.0';
        // validate
        if(isNaN(parseFloat(v))) throw new Error('Bad number '+t.v);
        return v;
      }
      if(t.t==='op' && t.v==='('){
        next();
        const e=expr();
        if(!peek() || peek().v!==')') throw new Error('Missing )');
        next();
        // function call? if previous was id handled below; here just grouping
        return `(${e})`;
      }
      if(t.t==='id'){
        next();
        // function call?
        if(peek() && peek().t==='op' && peek().v==='('){
          next();
          const args=[];
          if(!(peek() && peek().v===')')){
            args.push(expr());
            while(peek() && peek().v===','){ next(); args.push(expr()); }
          }
          if(!peek() || peek().v!==')') throw new Error('Missing ) in call');
          next();
          const name=t.v.toLowerCase();
          // map
          const fm=A.FUNC_MAP;
          const glslName = fm[name] || fm[t.v] || t.v;
          // constants? no
          // special: length with 1 arg? handle
          return `${glslName}(${args.join(',')})`;
        }
        // constant?
        const cm=A.CONST_MAP;
        if(cm[t.v]!==undefined) return cm[t.v];
        if(cm[t.v.toLowerCase()]!==undefined) return cm[t.v.toLowerCase()];
        // variable
        const v=t.v.toLowerCase();
        if(['x','y','z','t','u','v','p0','p1','p2','p3'].includes(v)) return v;
        throw new Error('Unknown identifier "'+t.v+'"');
      }
      throw new Error('Unexpected token "'+t.v+'"');
    }
    return {parse};
  }

  function transpile(s){
    s=s.trim();
    if(!s) throw new Error('Empty expression');
    const toks=tokenize(s);
    const p=makeParser(toks);
    return p.parse();
  }

  // ---------- presets ----------
  const PRESETS = [
    {name:'Sphere', expr:'len(x,y,z)-1.0', cm:0},
    {name:'Torus', expr:'sqrt((sqrt(x*x+z*z)-0.7)*(sqrt(x*x+z*z)-0.7)+y*y)-0.22', cm:1},
    {name:'Mandelbulb', expr:'mandelbulb(x,y,z)', cm:5},
    {name:'Menger sponge', expr:'menger(x,y,z)', cm:3},
    {name:'Gyroid', expr:'gyroid(x,y,z,1.4)+0.05*sin(t*2.0)', cm:6},
    {name:'Blobby union', expr:'smin(sphere(x,y,z,0.85), box(x,y-0.5,z,0.45,0.45,0.45), 0.35)', cm:0},
    {name:'Hollow sphere', expr:'max(len(x,y,z)-1.1, -(len(x,y,z)-0.85))', cm:2},
    {name:'Bumpy sphere', expr:'noise(x*3.0,y*3.0,z*3.0)*0.25 + len(x,y,z)-1.0', cm:4},
    {name:'Julia', expr:'julia(x,y,z)', cm:5},
    {name:'Terrain', expr:'y + 0.4*sin(x*2.0+t)*cos(z*2.0) + 0.12*fbm(x*2.0,y*0.3,z*2.0)', cm:1},
    {name:'Heart', expr:'heart(x,y,z)', cm:6},
    {name:'Twisted torus', expr:'torus(x*cos(t*0.5)-z*sin(t*0.5), y, x*sin(t*0.5)+z*cos(t*0.5), 0.7, 0.22)', cm:0},
    {name:'Replicated spheres', expr:'len(mod(x,1.2)-0.6, mod(y,1.2)-0.6, mod(z,1.2)-0.6)-0.35', cm:3},
    {name:'Animated gyroid', expr:'gyroid(x,y,z,1.0+0.3*sin(t*0.7))', cm:6},
  ];

  // ---------- state ----------
  const state = {
    expr: PRESETS[2].expr,
    colorMode: PRESETS[2].cm,
    quality: 'med',
    exposure: 1.2,
    fog: 0.35,
    bloom: 0.45,
    keyAz: 0.9,
    keyEl: 0.6,
    animSpeed: 0.6,
    animOn: true,
    autoOrbit: false,
    params: [0,0,0,0],
    cam: { yaw:0.6, pitch:0.35, r:4.5, tx:0, ty:0, tz:0 },
    mouse: { x:0.5, y:0.5 },
  };

  const COLOR_MODES = ['normal','height','depth','steps','ao','curvature','palette'];

  // ---------- WebGL program ----------
  let program=null, vao=null;
  const U={};
  function compileProgram(expr){
    const glsl = transpile(expr);
    const fragSrc = A.FRAG_TEMPLATE.replace('__SCENE__', glsl);
    const vs = compileShader(gl.VERTEX_SHADER, A.VERT);
    const fs = compileShader(gl.FRAGMENT_SHADER, fragSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog, gl.LINK_STATUS)){
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
      throw new Error(log);
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    // cleanup old
    if(program) gl.deleteProgram(program);
    program=prog;
    // uniforms
    const names=['uRes','uTime','uCamPos','uCamFwd','uCamRight','uCamUp','uFov','uMouse','uQuality','uExposure','uFog','uBloom','uColorMode','uKeyAz','uKeyEl','uPalette0','uPalette1','uP0','uP1','uP2','uP3'];
    for(const n of names) U[n]=gl.getUniformLocation(prog,n);
    // vao
    if(!vao){ vao=gl.createVertexArray(); }
    return glsl;
  }
  function compileShader(type, src){
    const sh=gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
      const log=gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(log);
    }
    return sh;
  }

  // ---------- camera helpers ----------
  function camPos(){
    const c=state.cam;
    const r=c.r;
    const cp=Math.cos(c.pitch), sp=Math.sin(c.pitch);
    const cy=Math.cos(c.yaw), sy=Math.sin(c.yaw);
    return [c.tx + r*cp*sy, c.ty + r*sp, c.tz + r*cp*cy];
  }
  function camBasis(){
    const eye=camPos();
    const t=[state.cam.tx,state.cam.ty,state.cam.tz];
    const f=[t[0]-eye[0], t[1]-eye[1], t[2]-eye[2]];
    const fl=Math.hypot(...f)||1;
    const fwd=[f[0]/fl, f[1]/fl, f[2]/fl];
    let right=[fwd[1]*0 - fwd[2]*0, fwd[2]*1 - fwd[0]*0, fwd[0]*0 - fwd[1]*1]; // cross(fwd, upWorld(0,1,0))? 
    // right = normalize(cross(fwd, worldUp))? Actually right = normalize(cross(worldUp, fwd))? Let's use standard: right = normalize(cross(fwd, up)) where up=(0,1,0) gives right pointing... 
    right = [fwd[1]*0 - fwd[2]*1, fwd[2]*0 - fwd[0]*0, fwd[0]*1 - fwd[1]*0];
    const rl=Math.hypot(...right)||1;
    right=[right[0]/rl,right[1]/rl,right[2]/rl];
    const up=[right[1]*fwd[2]-right[2]*fwd[1], right[2]*fwd[0]-right[0]*fwd[2], right[0]*fwd[1]-right[1]*fwd[0]];
    return {eye,fwd,right,up};
  }

  // ---------- resize ----------
  function qualityScale(q){
    return q==='low'?0.5: q==='med'?0.75: q==='high'?1.0:1.0;
  }
  function maxStepsFor(q){
    return q==='low'?48: q==='med'?96: q==='high'?128:160;
  }
  function uQualityVal(q){
    return q==='low'?0.2: q==='med'?0.5: q==='high'?0.8:1.0;
  }
  function resize(){
    const s=qualityScale(state.quality);
    const w=Math.max(1, Math.floor(window.innerWidth*s));
    const h=Math.max(1, Math.floor(window.innerHeight*s));
    if(canvas.width!==w || canvas.height!==h){ canvas.width=w; canvas.height=h; }
    gl.viewport(0,0,canvas.width,canvas.height);
  }
  window.addEventListener('resize', resize);

  // ---------- input ----------
  let dragging=false, dragMode='orbit', lastX=0, lastY=0;
  canvas.addEventListener('mousedown', e=>{
    dragging=true;
    dragMode = (e.button===2 || e.shiftKey) ? 'pan' : 'orbit';
    lastX=e.clientX; lastY=e.clientY;
    e.preventDefault();
  });
  window.addEventListener('mouseup', ()=>{ dragging=false; });
  window.addEventListener('mousemove', e=>{
    state.mouse.x = e.clientX/window.innerWidth;
    state.mouse.y = 1.0 - e.clientY/window.innerHeight;
    if(!dragging) return;
    const dx=e.clientX-lastX, dy=e.clientY-lastY;
    lastX=e.clientX; lastY=e.clientY;
    if(dragMode==='orbit'){
      state.cam.yaw -= dx*0.005;
      state.cam.pitch += dy*0.005;
      state.cam.pitch=Math.max(-1.4, Math.min(1.4, state.cam.pitch));
    } else {
      const b=camBasis();
      const s=state.cam.r*0.0015;
      state.cam.tx -= (b.right[0]*dx - b.up[0]*dy)*s;
      state.cam.ty -= (b.right[1]*dx - b.up[1]*dy)*s;
      state.cam.tz -= (b.right[2]*dx - b.up[2]*dy)*s;
    }
  });
  canvas.addEventListener('contextmenu', e=>e.preventDefault());
  canvas.addEventListener('wheel', e=>{
    e.preventDefault();
    state.cam.r *= (e.deltaY>0?1.12:0.89);
    state.cam.r=Math.max(1.2, Math.min(40, state.cam.r));
  }, {passive:false});
  canvas.addEventListener('dblclick', ()=>{
    state.cam.tx=0; state.cam.ty=0; state.cam.tz=0;
    state.cam.r=4.5; state.cam.yaw=0.6; state.cam.pitch=0.35;
  });

  // keyboard
  window.addEventListener('keydown', e=>{
    if(e.target && (e.target.tagName==='TEXTAREA' || e.target.tagName==='INPUT')) return;
    if(e.key==='a'||e.key==='A'){ toggleAudio(); }
    if(e.key==='p'||e.key==='P'){ document.getElementById('panel').classList.toggle('open'); }
    if(e.key==='s'||e.key==='S'){ screenshot(); }
    if(e.key==='?'){ document.getElementById('help').hidden = !document.getElementById('help').hidden; }
    if(e.key==='Escape'){ document.getElementById('help').hidden=true; }
  });

  // ---------- UI wiring ----------
  const $ = id=>document.getElementById(id);
  // presets
  const presetSel=$('preset');
  PRESETS.forEach((p,i)=>{
    const o=document.createElement('option'); o.value=i; o.textContent=p.name; presetSel.appendChild(o);
  });
  presetSel.value='2';
  presetSel.addEventListener('change', ()=>{
    const p=PRESETS[+presetSel.value];
    state.expr=p.expr;
    $('expr').value=p.expr;
    state.colorMode=COLOR_MODES.indexOf(COLOR_MODES[p.cm]);
    // map cm index
    state.colorMode = p.cm;
    $('colormode').value=COLOR_MODES[p.cm];
    scheduleCompile();
  });

  const exprTa=$('expr');
  exprTa.value=state.expr;
  let compileTimer=null;
  function scheduleCompile(delay=700){
    clearTimeout(compileTimer);
    compileTimer=setTimeout(()=>{ tryCompile(); }, delay);
  }
  exprTa.addEventListener('input', ()=>scheduleCompile());

  $('btnApply').addEventListener('click', ()=>{ state.expr=exprTa.value; tryCompile(true); });
  $('btnResetCam').addEventListener('click', ()=>{ state.cam.tx=0;state.cam.ty=0;state.cam.tz=0;state.cam.r=4.5;state.cam.yaw=0.6;state.cam.pitch=0.35; });

  $('colormode').addEventListener('change', e=>{
    state.colorMode=COLOR_MODES.indexOf(e.target.value);
  });

  function bindSlider(id, key, transform){
    const el=$(id);
    el.addEventListener('input', e=>{
      const v=parseFloat(e.target.value);
      state[key]=transform?transform(v):v;
    });
  }
  bindSlider('lAz','keyAz');
  bindSlider('lEl','keyEl');
  bindSlider('exposure','exposure');
  bindSlider('fog','fog');
  bindSlider('bloom','bloom');
  bindSlider('animSpeed','animSpeed');
  $('animOn').addEventListener('change', e=>{ state.animOn=e.target.checked; });
  $('autoOrbit').addEventListener('change', e=>{ state.autoOrbit=e.target.checked; });

  // quality
  $('quality').addEventListener('change', e=>{
    state.quality=e.target.value;
    resize();
  });

  // params sliders
  const slidersDiv=$('sliders');
  for(let i=0;i<4;i++){
    const wrap=document.createElement('label');
    wrap.innerHTML=`p${i} <input type="range" min="-2" max="2" step="0.01" value="0" data-p="${i}"><span class="pval">0.00</span>`;
    slidersDiv.appendChild(wrap);
    const inp=wrap.querySelector('input');
    const val=wrap.querySelector('.pval');
    inp.addEventListener('input', e=>{
      state.params[i]=parseFloat(e.target.value);
      val.textContent=state.params[i].toFixed(2);
    });
  }

  // audio
  function toggleAudio(){
    const on=A.audio.toggle();
    $('btnAudio').textContent = on?'Audio on':'Audio';
    $('btnAudio').classList.toggle('active', on);
  }
  $('btnAudio').addEventListener('click', toggleAudio);

  // panel
  $('btnPanel').addEventListener('click', ()=>{ $('panel').classList.toggle('open'); });

  // help
  $('btnHelp').addEventListener('click', ()=>{ $('help').hidden=!$('help').hidden; });
  $('btnCloseHelp').addEventListener('click', ()=>{ $('help').hidden=true; });

  // screenshot
  function screenshot(){
    const a=document.createElement('a');
    a.download='aether.png';
    a.href=canvas.toDataURL('image/png');
    a.click();
  }
  $('btnShot').addEventListener('click', screenshot);

  // share
  $('btnCopyLink').addEventListener('click', ()=>{
    const payload={
      e: state.expr,
      cm: state.colorMode,
      q: state.quality,
      p: state.params.slice(),
      cam: {y:state.cam.yaw, pi:state.cam.pitch, r:state.cam.r, t:[state.cam.tx,state.cam.ty,state.cam.tz]},
      ls: {az:state.keyAz, el:state.keyEl, ex:state.exposure, fog:state.fog, bloom:state.bloom},
      as: state.animSpeed, ao: state.animOn, aorb: state.autoOrbit,
    };
    const enc=btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    const url = location.origin + location.pathname + '#' + enc;
    navigator.clipboard.writeText(url).then(()=>{ $('status').textContent='link copied'; setTimeout(()=>{$('status').textContent='ready';},1500); }).catch(()=>{});
    location.hash=enc;
  });
  $('btnImport').addEventListener('click', ()=>{
    const box=$('importBox');
    box.hidden=!box.hidden;
    if(!box.hidden) box.focus();
  });
  $('importBox').addEventListener('change', e=>{
    try{
      const hash=e.target.value.split('#').pop();
      const payload=JSON.parse(decodeURIComponent(escape(atob(hash))));
      applyPayload(payload);
      $('importBox').hidden=true; $('importBox').value='';
    }catch(err){ $('err').textContent='Import failed: '+err.message; }
  });

  function applyPayload(pl){
    if(pl.e){ state.expr=pl.e; exprTa.value=pl.e; }
    if(typeof pl.cm==='number'){ state.colorMode=pl.cm; $('colormode').value=COLOR_MODES[pl.cm]; }
    if(pl.q){ state.quality=pl.q; $('quality').value=pl.q; resize(); }
    if(pl.p){ state.params=pl.p.slice(); 
      document.querySelectorAll('#sliders input').forEach((inp,i)=>{ inp.value=state.params[i]; inp.dispatchEvent(new Event('input')); });
    }
    if(pl.cam){ state.cam.yaw=pl.cam.y; state.cam.pitch=pl.cam.pi; state.cam.r=pl.cam.r; state.cam.tx=pl.cam.t[0]; state.cam.ty=pl.cam.t[1]; state.cam.tz=pl.cam.t[2]; }
    if(pl.ls){ state.keyAz=pl.ls.az; state.keyEl=pl.ls.el; state.exposure=pl.ls.ex; state.fog=pl.ls.fog; state.bloom=pl.ls.bloom;
      $('lAz').value=state.keyAz; $('lEl').value=state.keyEl; $('exposure').value=state.exposure; $('fog').value=state.fog; $('bloom').value=state.bloom;
    }
    if(typeof pl.as==='number'){ state.animSpeed=pl.as; $('animSpeed').value=pl.as; }
    if(typeof pl.ao==='boolean'){ state.animOn=pl.ao; $('animOn').checked=pl.ao; }
    if(typeof pl.aorb==='boolean'){ state.autoOrbit=pl.aorb; $('autoOrbit').checked=pl.aorb; }
    tryCompile(true);
  }

  // load from hash
  if(location.hash.length>1){
    try{
      const payload=JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(1)))));
      // defer
      setTimeout(()=>applyPayload(payload), 100);
    }catch(e){}
  }

  // ---------- compile ----------
  let currentExpr = null;
  function tryCompile(force){
    const src = exprTa.value;
    $('err').textContent='';
    try{
      const glsl = compileProgram(src);
      currentExpr = src;
      state.expr = src;
      $('err').textContent='';
      $('status').textContent='compiled';
    }catch(err){
      $('err').textContent = (err && err.message) ? err.message.split('\n')[0] : String(err);
      $('status').textContent='compile error';
      // keep previous program if exists
    }
  }

  // initial compile
  tryCompile(true);

  // ---------- render loop ----------
  let lastT=performance.now();
  let frames=0, fpsAcc=0, fpsTime=0;
  function frame(now){
    requestAnimationFrame(frame);
    const dt=(now-lastT)/1000; lastT=now;
    resize();
    if(!program) return;
    // time
    if(state.animOn){ state.time = (state.time||0) + dt*state.animSpeed; }
    state.time = state.time||0;
    if(state.autoOrbit){ state.cam.yaw += dt*0.25; }

    gl.useProgram(program);
    gl.bindVertexArray(vao);
    const b=camBasis();
    const eye=b.eye;
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, state.time);
    gl.uniform3f(U.uCamPos, eye[0],eye[1],eye[2]);
    gl.uniform3f(U.uCamFwd, b.fwd[0],b.fwd[1],b.fwd[2]);
    gl.uniform3f(U.uCamRight, b.right[0],b.right[1],b.right[2]);
    gl.uniform3f(U.uCamUp, b.up[0],b.up[1],b.up[2]);
    gl.uniform1f(U.uFov, Math.tan(50*Math.PI/180/2));
    gl.uniform2f(U.uMouse, state.mouse.x, state.mouse.y);
    gl.uniform1f(U.uQuality, uQualityVal(state.quality));
    gl.uniform1f(U.uExposure, state.exposure);
    gl.uniform1f(U.uFog, state.fog);
    gl.uniform1f(U.uBloom, state.bloom);
    gl.uniform1f(U.uColorMode, state.colorMode);
    gl.uniform1f(U.uKeyAz, state.keyAz);
    gl.uniform1f(U.uKeyEl, state.keyEl);
    gl.uniform3f(U.uPalette0, 0.1,0.4,0.9);
    gl.uniform3f(U.uPalette1, 0.9,0.3,0.6);
    gl.uniform1f(U.uP0, state.params[0]);
    gl.uniform1f(U.uP1, state.params[1]);
    gl.uniform1f(U.uP2, state.params[2]);
    gl.uniform1f(U.uP3, state.params[3]);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // fps
    frames++;
    fpsAcc += 1/dt;
    if(now - fpsTime > 500){
      const fps = Math.round(fpsAcc/frames);
      $('fps').textContent = fps + ' fps';
      $('steps').textContent = 'scale ' + qualityScale(state.quality).toFixed(2) + ' · ' + maxStepsFor(state.quality) + ' steps';
      frames=0; fpsAcc=0; fpsTime=now;
    }
  }
  requestAnimationFrame(frame);

  // boot hide
  setTimeout(()=>{ const b=$('boot'); if(b){ b.style.opacity='0'; setTimeout(()=>b.remove(),400); } }, 600);
})();
