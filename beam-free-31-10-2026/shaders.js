// GLSL shader templates and helpers for AETHER
window.AETHER = window.AETHER || {};

// Vertex shader: full-screen triangle
window.AETHER.VERT = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  // big triangle covering clip space
  vec2 p = vec2((gl_VertexID==1)?3.0:-1.0, (gl_VertexID==2)?3.0:-1.0);
  vUv = p*0.5+0.5;
  gl_Position = vec4(p,0.0,1.0);
}`;

// Fragment shader template. __SCENE__ is replaced with the SDF expression.
// __COLOR__ handling done in shader via uColorMode.
window.AETHER.FRAG_TEMPLATE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform vec2 uRes;
uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uCamFwd;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uFov;
uniform vec2 uMouse; // 0..1
uniform float uQuality; // 0..1
uniform float uExposure;
uniform float uFog;
uniform float uBloom;
uniform float uColorMode; // 0..6
uniform float uKeyAz;
uniform float uKeyEl;
uniform vec3 uPalette0;
uniform vec3 uPalette1;

// ---- helpers ----
float LEN(float x,float y,float z){ return sqrt(x*x+y*y+z*z); }
float DOT3(float ax,float ay,float az,float bx,float by,float bz){ return ax*bx+ay*by+az*bz; }

float hash1(float n){ return fract(sin(n)*43758.5453123); }
float hash3(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }

// value noise
float noise(vec3 p){
  vec3 i=floor(p); vec3 f=fract(p);
  f=f*f*(3.0-2.0*f);
  float n000=hash3(i);
  float n100=hash3(i+vec3(1,0,0));
  float n010=hash3(i+vec3(0,1,0));
  float n110=hash3(i+vec3(1,1,0));
  float n001=hash3(i+vec3(0,0,1));
  float n101=hash3(i+vec3(1,0,1));
  float n011=hash3(i+vec3(0,1,1));
  float n111=hash3(i+vec3(1,1,1));
  float nx00=mix(n000,n100,f.x);
  float nx10=mix(n010,n110,f.x);
  float nx01=mix(n001,n101,f.x);
  float nx11=mix(n011,n111,f.x);
  float nxy0=mix(nx00,nx10,f.y);
  float nxy1=mix(nx01,nx11,f.y);
  return mix(nxy0,nxy1,f.z);
}
float fbm(vec3 p){
  float v=0.0; float a=0.5;
  for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.0; a*=0.5; }
  return v;
}
// scalar overloads for expression convenience
float noise(float x,float y,float z){ return noise(vec3(x,y,z)); }
float fbm(float x,float y,float z){ return fbm(vec3(x,y,z)); }
float LEN3(float x,float y,float z){ return LEN(x,y,z); }

// shapes
float sphere(float x,float y,float z,float r){ return LEN(x,y,z)-r; }
float box(float x,float y,float z,float sx,float sy,float sz){
  vec3 q=abs(vec3(x,y,z))-vec3(sx,sy,sz);
  return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0);
}
float torus(float x,float y,float z,float R,float r){
  float q=sqrt(x*x+z*z)-R;
  return sqrt(q*q+y*y)-r;
}
float cylinder(float x,float y,float z,float r,float h){
  float d=sqrt(x*x+z*z)-r;
  float q=abs(y)-h;
  return max(d,q)+min(max(d,q),0.0); // approx
}
float plane(float x,float y,float z,float nx,float ny,float nz,float d){
  return x*nx+y*ny+z*nz-d;
}

// fractals
float mandelbulb(float x,float y,float z){
  vec3 p=vec3(x,y,z);
  vec3 zv=p;
  float dr=1.0; float r=0.0;
  for(int i=0;i<8;i++){
    r=length(zv);
    if(r>2.0) break;
    float theta=acos(zv.z/r);
    float phi=atan(zv.y,zv.x);
    dr=pow(r,7.0)*8.0*dr+1.0;
    float zr=pow(r,8.0);
    theta*=8.0; phi*=8.0;
    zv=zr*vec3(sin(theta)*cos(phi), sin(theta)*sin(phi), cos(theta))+p;
  }
  return 0.5*log(max(r,1e-6))*r/max(dr,1e-6);
}
float menger(float x,float y,float z){
  vec3 p=vec3(x,y,z);
  float d=box(x,y,z,1.0,1.0,1.0);
  float s=1.0;
  for(int i=0;i<4;i++){
    vec3 a=mod(p*s,2.0)-1.0;
    s*=3.0;
    vec3 r=abs(1.0-3.0*abs(a));
    float da=max(r.x,r.y);
    float db=max(r.x,r.z);
    float dc=max(r.y,r.z);
    float c=(min(da,min(db,dc))-1.0)/s;
    d=max(d,c);
  }
  return d;
}
float heart(float x,float y,float z){
  float a=x*x+2.25*y*y+z*z-1.0;
  return a*a*a - x*x*z*z*z - 0.1125*y*y*z*z*z;
}
float gyroid(float x,float y,float z,float scale){
  vec3 p=vec3(x,y,z)*scale;
  return (sin(p.x)*cos(p.y)+sin(p.y)*cos(p.z)+sin(p.z)*cos(p.x))/scale;
}
float julia(float x,float y,float z){
  vec3 p=vec3(x,y,z);
  vec3 zv=p;
  for(int i=0;i<10;i++){
    float r=length(zv);
    if(r>2.0) break;
    float theta=acos(clamp(zv.z/r,-1.0,1.0));
    float phi=atan(zv.y,zv.x);
    float zr=r*r;
    theta*=2.0; phi*=2.0;
    zv=zr*vec3(sin(theta)*cos(phi), sin(theta)*sin(phi), cos(theta)) + vec3(-0.8,0.156,0.0);
  }
  return (length(zv)-2.0)*0.5;
}

// smooth min
float smin(float a,float b,float k){
  float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0);
  return mix(b,a,h)-k*h*(1.0-h);
}
float smax(float a,float b,float k){ return -smin(-a,-b,k); }

// ---- scene SDF (injected) ----
float sceneSDF(vec3 p, float t, float u, float v){
  float x=p.x; float y=p.y; float z=p.z;
  return __SCENE__;
}

// normal
vec3 calcNormal(vec3 p, float t, float u, float v){
  float e=0.001;
  return normalize(vec3(
    sceneSDF(p+vec3(e,0,0),t,u,v)-sceneSDF(p-vec3(e,0,0),t,u,v),
    sceneSDF(p+vec3(0,e,0),t,u,v)-sceneSDF(p-vec3(0,e,0),t,u,v),
    sceneSDF(p+vec3(0,0,e),t,u,v)-sceneSDF(p-vec3(0,0,e),t,u,v)
  ));
}

// shadow
float softShadow(vec3 ro, vec3 rd, float t, float u, float v, float mint, float maxt, float k){
  float res=1.0; float ph=1e20;
  float dt=0.0;
  for(int i=0;i<48;i++){
    if(dt>maxt) break;
    float h=sceneSDF(ro+rd*dt,t,u,v);
    if(h<0.001){ return 0.0; }
    float y=h*h/(2.0*ph);
    float d=sqrt(h*h-ph*ph*0.0); // approx
    // simpler cone
    res=min(res, k*h/max(dt,0.001));
    ph=h;
    dt+=clamp(h,0.01,0.2);
  }
  return clamp(res,0.0,1.0);
}

// AO
float calcAO(vec3 p, vec3 n, float t, float u, float v){
  float occ=0.0; float sca=1.0;
  for(int i=0;i<5;i++){
    float h=0.01+0.12*float(i);
    float d=sceneSDF(p+n*h,t,u,v);
    occ+=(h-d)*sca;
    sca*=0.95;
  }
  return clamp(1.0-occ*2.0,0.0,1.0);
}

// palette
vec3 palette(float d){
  return 0.5+0.5*cos(6.28318*(d*vec3(1.0,0.7,0.4)+vec3(0.0,0.15,0.35)));
}

void main(){
  vec2 uv=(vUv-0.5)*2.0;
  uv.x*=uRes.x/uRes.y;
  float tanHalf=uFov;
  vec3 rd=normalize(uCamFwd + uCamRight*uv.x*tanHalf + uCamUp*uv.y*tanHalf);
  vec3 ro=uCamPos;
  float u=uMouse.x; float v=uMouse.y;

  float maxSteps=mix(48.0,160.0,uQuality);
  float maxDist=mix(12.0,40.0,uQuality);
  float surfEps=0.001;

  float dt=0.0; float steps=0.0;
  bool hit=false;
  for(float i=0.0;i<160.0;i++){
    if(i>=maxSteps) break;
    vec3 p=ro+rd*dt;
    float d=sceneSDF(p,uTime,u,v);
    if(d<surfEps){ hit=true; break; }
    if(dt>maxDist) break;
    dt+=max(d*0.9,0.005);
    steps=i;
  }

  vec3 col=vec3(0.02,0.03,0.06);
  // background: stars + gradient
  float sky=mix(0.0,1.0, clamp(rd.y*0.5+0.5,0.0,1.0));
  col=mix(vec3(0.01,0.015,0.03), vec3(0.05,0.08,0.15), sky);
  // stars
  vec2 sp=rd.xz/(abs(rd.y)+0.1);
  float st=hash1(floor(sp.x*200.0)+floor(sp.y*200.0)*37.0);
  if(st>0.995 && rd.y>0.0) col+=vec3(0.8,0.9,1.0)*0.6;

  if(hit){
    vec3 p=ro+rd*dt;
    vec3 n=calcNormal(p,uTime,u,v);
    vec3 lightDir=normalize(vec3(cos(uKeyEl)*cos(uKeyAz), sin(uKeyEl), cos(uKeyEl)*sin(uKeyAz)));
    float diff=max(dot(n,lightDir),0.0);
    float sh= (uQuality>0.5)? softShadow(p+n*0.01, lightDir, uTime,u,v,0.01,maxDist,8.0):1.0;
    float ao= (uQuality>0.3)? calcAO(p,n,uTime,u,v):1.0;
    float spec=pow(max(dot(reflect(-lightDir,n),-rd),0.0),32.0)*0.4;
    // curvature approx
    float curv=0.0;
    {
      float e=0.05;
      curv= (sceneSDF(p+vec3(e,0,0),uTime,u,v)+sceneSDF(p-vec3(e,0,0),uTime,u,v)
            +sceneSDF(p+vec3(0,e,0),uTime,u,v)+sceneSDF(p-vec3(0,e,0),uTime,u,v)
            +sceneSDF(p+vec3(0,0,e),uTime,u,v)+sceneSDF(p-vec3(0,0,e),uTime,u,v)
            -6.0*sceneSDF(p,uTime,u,v))/(e*e);
    }
    // base color by mode
    vec3 baseCol;
    int cm=int(uColorMode+0.5);
    if(cm==0){ baseCol=0.5+0.5*n; }
    else if(cm==1){ baseCol=palette(p.y*0.5+0.5); }
    else if(cm==2){ baseCol=mix(vec3(0.9,0.95,1.0), vec3(0.1,0.2,0.4), clamp(dt/maxDist,0.0,1.0)); }
    else if(cm==3){ baseCol=palette(steps/maxSteps); }
    else if(cm==4){ baseCol=vec3(ao); }
    else if(cm==5){ baseCol=palette(clamp(curv*0.1+0.5,0.0,1.0)); }
    else { baseCol=palette(fract(uTime*0.1+p.x*0.3)); }
    vec3 lit=baseCol*(0.15+0.85*diff*sh*ao) + vec3(1.0)*spec*sh;
    // reflections (high quality)
    if(uQuality>0.75){
      vec3 reflDir=reflect(rd,n);
      // one step march for reflection color (approx env)
      lit+=0.15* (0.5+0.5*reflDir.y) * baseCol * ao;
    }
    col=lit;
    // fog
    float fogAmt=1.0-exp(-dt*uFog*0.15);
    col=mix(col, vec3(0.02,0.03,0.06), fogAmt);
  }

  // bloom-ish: brighten center (cheap)
  col*=uExposure;
  col += pow(max(col,0.0),vec3(2.0))*uBloom*0.4;
  // vignette
  vec2 vc=vUv-0.5;
  col*=1.0-0.35*dot(vc,vc)*2.0;
  // tone map
  col=col/(1.0+col);
  col=pow(col,vec3(1.0/2.2));

  outColor=vec4(col,1.0);
}
`;

// Function map: expression identifiers -> GLSL. Most are identity.
window.AETHER.FUNC_MAP = {
  sin:'sin', cos:'cos', tan:'tan', asin:'asin', acos:'acos', atan:'atan', atan2:'atan',
  sinh:'sinh', cosh:'cosh', tanh:'tanh', exp:'exp', log:'log', sqrt:'sqrt', abs:'abs',
  floor:'floor', ceil:'ceil', round:'round', min:'min', max:'max', pow:'pow', mod:'mod',
  fract:'fract', clamp:'clamp', mix:'mix', step:'step', smoothstep:'smoothstep',
  len:'LEN', dot:'DOT3',
  noise:'noise', fbm:'fbm',
  sphere:'sphere', box:'box', torus:'torus', cylinder:'cylinder', plane:'plane',
  mandelbulb:'mandelbulb', menger:'menger', gyroid:'gyroid', julia:'julia',
  smin:'smin', smax:'smax'
};
// constants
window.AETHER.CONST_MAP = { pi:'3.14159265359', PI:'3.14159265359', e:'2.71828182846', tau:'6.28318530718', TAU:'6.28318530718' };
