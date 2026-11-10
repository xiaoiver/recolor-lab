export function colorLab(hex) {
  const c=hex.match(/[a-f0-9]{2}/gi).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  const l=Math.cbrt(.4122214708*c[0]+.5363325363*c[1]+.0514459929*c[2]);
  const m=Math.cbrt(.2119034982*c[0]+.6806995451*c[1]+.1073969566*c[2]);
  const s=Math.cbrt(.0883024619*c[0]+.2817188376*c[1]+.6299787005*c[2]);
  return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
}
const glsl=`#version 300 es
precision highp float;
in vec2 uv; out vec4 outColor;
uniform sampler2D image; uniform sampler2D mask;
uniform vec4 p; uniform vec4 q;
vec3 linearize(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec3 encode(vec3 c){c=max(c,vec3(0.));return mix(12.92*c,1.055*pow(c,vec3(1./2.4))-.055,step(vec3(.0031308),c));}
vec3 lab(vec3 c){vec3 t=pow(max(vec3(dot(c,vec3(.4122214708,.5363325363,.0514459929)),dot(c,vec3(.2119034982,.6806995451,.1073969566)),dot(c,vec3(.0883024619,.2817188376,.6299787005))),vec3(0.)),vec3(1./3.));return vec3(dot(t,vec3(.2104542553,.793617785,-.0040720468)),dot(t,vec3(1.9779984951,-2.428592205,.4505937099)),dot(t,vec3(.0259040371,.7827717662,-.808675766)));}
vec3 rgb(vec3 c){vec3 t=vec3(c.x+.3963377774*c.y+.2158037573*c.z,c.x-.1055613458*c.y-.0638541728*c.z,c.x-.0894841775*c.y-1.291485548*c.z);t=t*t*t;return vec3(dot(t,vec3(4.0767416621,-3.3077115913,.2309699292)),dot(t,vec3(-1.2684380046,2.6097574011,-.3413193965)),dot(t,vec3(-.0041960863,-.7034186147,1.707614701)));}
void main(){vec3 original=texture(image,uv).rgb;vec2 d=1./vec2(textureSize(mask,0));float m=texture(mask,uv).r*.5; m+=(texture(mask,uv+vec2(d.x,0)).r+texture(mask,uv-vec2(d.x,0)).r+texture(mask,uv+vec2(0,d.y)).r+texture(mask,uv-vec2(0,d.y)).r)*.125;m=smoothstep(q.x-.12,q.x+.12,m);vec3 c=lab(linearize(original));vec3 changed=clamp(encode(rgb(vec3(clamp(c.x+p.w,0.,1.),p.xy))),0.,1.);if(q.w>.5){float alpha=m*p.z;if(q.z==1.&&uv.x<q.y)alpha=0.;if(q.z==1.&&abs(uv.x-q.y)<.0012){outColor=vec4(.9,.95,.8,1.);return;}outColor=vec4(changed,alpha);return;}vec3 result=mix(original,changed,m*p.z);if(q.z==1.&&uv.x<q.y)result=original;if(q.z==2.)result=vec3(m);if(q.z==3.)result=original;if(q.z==1.&&abs(uv.x-q.y)<.0012)result=vec3(.9,.95,.8);outColor=vec4(result,1.);}`;
const wgsl=`struct Params{p:vec4f,q:vec4f};
@group(0) @binding(0) var smp:sampler;
@group(0) @binding(1) var image:texture_2d<f32>;
@group(0) @binding(2) var mask:texture_2d<f32>;
@group(0) @binding(3) var<uniform> params:Params;
struct VOut{@builtin(position) position:vec4f,@location(0) uv:vec2f};
@vertex fn vert(@builtin(vertex_index) i:u32)->VOut{let xy=array<vec2f,3>(vec2f(-1.,-1.),vec2f(3.,-1.),vec2f(-1.,3.));var o:VOut;o.position=vec4f(xy[i],0.,1.);o.uv=xy[i]*vec2f(.5,-.5)+vec2f(.5);return o;}
fn linearize(c:vec3f)->vec3f{return select(c/12.92,pow((c+.055)/1.055,vec3f(2.4)),c>vec3f(.04045));}
fn encode(v:vec3f)->vec3f{let c=max(v,vec3f(0.));return select(12.92*c,1.055*pow(c,vec3f(1./2.4))-.055,c>vec3f(.0031308));}
fn lab(c:vec3f)->vec3f{let t=pow(max(vec3f(dot(c,vec3f(.4122214708,.5363325363,.0514459929)),dot(c,vec3f(.2119034982,.6806995451,.1073969566)),dot(c,vec3f(.0883024619,.2817188376,.6299787005))),vec3f(0.)),vec3f(1./3.));return vec3f(dot(t,vec3f(.2104542553,.793617785,-.0040720468)),dot(t,vec3f(1.9779984951,-2.428592205,.4505937099)),dot(t,vec3f(.0259040371,.7827717662,-.808675766)));}
fn rgb(c:vec3f)->vec3f{var t=vec3f(c.x+.3963377774*c.y+.2158037573*c.z,c.x-.1055613458*c.y-.0638541728*c.z,c.x-.0894841775*c.y-1.291485548*c.z);t=t*t*t;return vec3f(dot(t,vec3f(4.0767416621,-3.3077115913,.2309699292)),dot(t,vec3f(-1.2684380046,2.6097574011,-.3413193965)),dot(t,vec3f(-.0041960863,-.7034186147,1.707614701)));}
@fragment fn frag(in:VOut)->@location(0) vec4f{let uv=in.uv;let p=params.p;let q=params.q;let original=textureSample(image,smp,uv).rgb;let d=1./vec2f(textureDimensions(mask));var m=textureSample(mask,smp,uv).r*.5;m+=(textureSample(mask,smp,uv+vec2f(d.x,0)).r+textureSample(mask,smp,uv-vec2f(d.x,0)).r+textureSample(mask,smp,uv+vec2f(0,d.y)).r+textureSample(mask,smp,uv-vec2f(0,d.y)).r)*.125;m=smoothstep(q.x-.12,q.x+.12,m);let c=lab(linearize(original));let changed=clamp(encode(rgb(vec3f(clamp(c.x+p.w,0.,1.),p.xy))),vec3f(0.),vec3f(1.));if(q.w>.5){var alpha=m*p.z;if(q.z==1.&&uv.x<q.y){alpha=0.;}if(q.z==1.&&abs(uv.x-q.y)<.0012){return vec4f(.9,.95,.8,1.);}return vec4f(changed,alpha);}var result=mix(original,changed,m*p.z);if(q.z==1.&&uv.x<q.y){result=original;}if(q.z==2.){result=vec3f(m);}if(q.z==3.){result=original;}if(q.z==1.&&abs(uv.x-q.y)<.0012){result=vec3f(.9,.95,.8);}return vec4f(result,1.);}`;
function uniforms(s,overlay=false){const c=colorLab(s.color);return new Float32Array([c[1],c[2],s.amount,s.lightness,s.threshold,s.split,s.view,overlay?1:0]);}
class WebGLRenderer{
  constructor(canvas){this.canvas=canvas;this.name='WebGL 2';const gl=this.gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true,antialias:false});if(!gl)throw Error('当前浏览器没有可用的 WebGL 2。');
    const compile=(type,src)=>{const shader=gl.createShader(type);gl.shaderSource(shader,src);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
    this.program=gl.createProgram();gl.attachShader(this.program,compile(gl.VERTEX_SHADER,`#version 300 es\nout vec2 uv;void main(){vec2 xy=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(xy*2.-1.,0.,1.);uv=xy*vec2(1.,-1.)+vec2(0.,1.);}`));gl.attachShader(this.program,compile(gl.FRAGMENT_SHADER,glsl));gl.linkProgram(this.program);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));gl.useProgram(this.program);gl.uniform1i(gl.getUniformLocation(this.program,'image'),0);gl.uniform1i(gl.getUniformLocation(this.program,'mask'),1);
    this.textures=[0,1].map(()=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;});this.setMask(new Uint8Array(1),1,1);
  }
  setFrame(source,w,h){const gl=this.gl;if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.textures[0]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);this.ready=true;}
  setMask(bytes,w,h){const gl=this.gl;gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.textures[1]);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,w,h,0,gl.RED,gl.UNSIGNED_BYTE,bytes);}
  setLayerMasks(layers){
    const gl=this.gl;this.layerMasks??=new Map();const keep=new Set(layers.map(l=>l.id));
    for(const [id,layer] of this.layerMasks)if(!keep.has(id)){gl.deleteTexture(layer.texture);this.layerMasks.delete(id);}
    gl.activeTexture(gl.TEXTURE1);
    for(const layer of layers){let item=this.layerMasks.get(layer.id);if(!item){item={texture:gl.createTexture()};this.layerMasks.set(layer.id,item);gl.bindTexture(gl.TEXTURE_2D,item.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);}gl.bindTexture(gl.TEXTURE_2D,item.texture);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,layer.width,layer.height,0,gl.RED,gl.UNSIGNED_BYTE,layer.mask);}
  }
  draw(s,layers=null){
    if(!this.ready)return;const gl=this.gl;gl.useProgram(this.program);gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.textures[0]);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.textures[1]);
    const paint=(settings,overlay)=>{const u=uniforms(settings,overlay);gl.uniform4fv(gl.getUniformLocation(this.program,'p'),u.subarray(0,4));gl.uniform4fv(gl.getUniformLocation(this.program,'q'),u.subarray(4));gl.drawArrays(gl.TRIANGLES,0,3);};
    gl.disable(gl.BLEND);paint(layers?{...s,amount:0}:s,false);
    if(layers&&s.view!==2&&s.view!==3){gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);for(const layer of layers){const item=this.layerMasks?.get(layer.id);if(!item)continue;gl.bindTexture(gl.TEXTURE_2D,item.texture);paint({...s,...layer},true);}gl.disable(gl.BLEND);}
  }
}
class WebGPURenderer{
  async init(canvas,adapter){this.canvas=canvas;this.name='WebGPU';const d=this.device=await adapter.requestDevice();const module=d.createShaderModule({code:wgsl});const info=await module.getCompilationInfo();const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('; '));this.format=navigator.gpu.getPreferredCanvasFormat();this.ctx=canvas.getContext('webgpu');this.ctx.configure({device:d,format:this.format,alphaMode:'opaque'});this.pipeline=await d.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vert'},fragment:{module,entryPoint:'frag',targets:[{format:this.format}]},primitive:{topology:'triangle-list'}});this.overlayPipeline=await d.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vert'},fragment:{module,entryPoint:'frag',targets:[{format:this.format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});this.sampler=d.createSampler({magFilter:'linear',minFilter:'linear'});this.params=d.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.setMask(new Uint8Array(1),1,1);d.lost.then(()=>{document.dispatchEvent(new CustomEvent('gpu-lost'));});return this;}
  texture(w,h,format){return this.device.createTexture({size:[w,h],format,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});}
  setFrame(source,w,h){if(this.canvas.width!==w||this.canvas.height!==h||!this.image){this.image?.destroy();this.canvas.width=w;this.canvas.height=h;this.image=this.texture(w,h,'rgba8unorm');}this.device.queue.copyExternalImageToTexture({source},{texture:this.image},[w,h]);this.ready=true;}
  setMask(bytes,w,h){if(this.mw!==w||this.mh!==h){this.mask?.destroy();this.mask=this.texture(w,h,'r8unorm');this.mw=w;this.mh=h;}this.device.queue.writeTexture({texture:this.mask},bytes,{bytesPerRow:w},[w,h]);}
  setLayerMasks(layers){
    const d=this.device;this.layerMasks??=new Map();const keep=new Set(layers.map(l=>l.id));
    for(const [id,item] of this.layerMasks)if(!keep.has(id)){item.mask.destroy();item.params.destroy();this.layerMasks.delete(id);}
    for(const layer of layers){let item=this.layerMasks.get(layer.id);if(!item){item={params:d.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})};this.layerMasks.set(layer.id,item);}if(item.width!==layer.width||item.height!==layer.height){item.mask?.destroy();item.mask=this.texture(layer.width,layer.height,'r8unorm');item.width=layer.width;item.height=layer.height;}d.queue.writeTexture({texture:item.mask},layer.mask,{bytesPerRow:layer.width},[layer.width,layer.height]);}
  }
  draw(s,layers=null){
    if(!this.ready)return;const d=this.device;d.queue.writeBuffer(this.params,0,uniforms(layers?{...s,amount:0}:s));
    const bind=(pipeline,mask,params)=>d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.sampler},{binding:1,resource:this.image.createView()},{binding:2,resource:mask.createView()},{binding:3,resource:{buffer:params}}]});
    const encoder=d.createCommandEncoder();const pass=encoder.beginRenderPass({colorAttachments:[{view:this.ctx.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}]});pass.setPipeline(this.pipeline);pass.setBindGroup(0,bind(this.pipeline,this.mask,this.params));pass.draw(3);
    if(layers&&s.view!==2&&s.view!==3){for(const layer of layers){const item=this.layerMasks?.get(layer.id);if(!item)continue;d.queue.writeBuffer(item.params,0,uniforms({...s,...layer},true));pass.setPipeline(this.overlayPipeline);pass.setBindGroup(0,bind(this.overlayPipeline,item.mask,item.params));pass.draw(3);}}
    pass.end();d.queue.submit([encoder.finish()]);
  }
}
export async function createRenderer(canvas){
  if(navigator.gpu&&!new URLSearchParams(location.search).has('webgl')){try{const adapter=await navigator.gpu.requestAdapter();if(adapter)return await new WebGPURenderer().init(canvas,adapter);}catch(e){console.warn('WebGPU fallback:',e);if(canvas.getContext('webgpu')){const replacement=canvas.cloneNode();canvas.replaceWith(replacement);canvas=replacement;}}}
  return new WebGLRenderer(canvas);
}
