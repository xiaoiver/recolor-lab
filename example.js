import {createRenderer} from './renderer.js';
import {FalObjectSequence} from './rle.js';
import {ObjectEdits,DEFAULT_EDIT,frameLayers} from './edits.js';
import {ColorWheel} from './color-wheel.js';
import {rankPointMasks} from './regions.js';

const $=id=>document.getElementById(id),video=$('video'),edits=new ObjectEdits();
const state={...DEFAULT_EDIT,view:0,split:.5};
const url=new URL(location.href);if(url.searchParams.has('job')){url.searchParams.delete('job');history.replaceState(null,'',url);}
const storageKey='recolor-example-edits-v1';
// Preserve this browser's edits when migrating the existing cached demo.
const legacyStorageKey='recolor-edits:f82d0332053b4828afc6526275814a12';
let sample,sequence,renderer,wheel,frame=-1,layerFrame=-1,layerKeys='',layers=[],ready=false,cycles=0,lastMediaTime=-1,lastTimeUI=0,outlineUntil=0,outlineEnabled=false;
const localSam={worker:null,nextId:0,pending:new Map(),loaded:false,active:false,busy:false,masks:null,maskDims:null,scores:null,preview:false};
const hasVideoFrames=typeof video.requestVideoFrameCallback==='function';
const status=(text,error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error);};
const safe=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(error=>{status(error.message,true);console.error(error);});
function label(id){return sample.labels[id]||`目标 ${id+1}`;}
function persist(){try{sessionStorage.setItem(storageKey,JSON.stringify(edits.toJSON()));}catch{}}
function time(value){return `${Math.floor((value||0)/60).toString().padStart(2,'0')}:${Math.floor((value||0)%60).toString().padStart(2,'0')}`;}
function localSamStatus(text,error=false){$('local-sam-status').textContent=text;$('local-sam-status').classList.toggle('error',error);}
function syncLocalPreview(){ $('local-mask').hidden=!(localSam.preview&&frame===0&&video.paused); }
function samRequest(type,payload,transfer=[]){
  if(!localSam.worker){
    localSam.worker=new Worker('./sam2-worker.js',{type:'module'});
    localSam.worker.onmessage=({data})=>{
      if(data.type==='progress'){localSamStatus(data.stage);return;}
      const request=localSam.pending.get(data.id);if(!request)return;
      localSam.pending.delete(data.id);
      if(data.type==='error')request.reject(Error(data.error));else request.resolve(data);
    };
    localSam.worker.onerror=event=>{for(const request of localSam.pending.values())request.reject(Error(event.message||'端侧 SAM Worker 已停止'));localSam.pending.clear();};
  }
  const id=++localSam.nextId;
  return new Promise((resolve,reject)=>{localSam.pending.set(id,{resolve,reject});localSam.worker.postMessage({id,type,payload},transfer);});
}
function captureSamInput(){
  const size=1024,canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
  const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(video,0,0,size,size);
  const rgba=context.getImageData(0,0,size,size).data,pixels=new Float32Array(3*size*size),plane=size*size;
  for(let p=0,i=0;p<plane;p++,i+=4){pixels[p]=rgba[i]/255;pixels[plane+p]=rgba[i+1]/255;pixels[plane*2+p]=rgba[i+2]/255;}
  return {pixels,shape:[1,3,size,size]};
}
function seekStart(){
  if(video.currentTime<.001&&!video.seeking)return Promise.resolve();
  return new Promise((resolve,reject)=>{const done=()=>{video.removeEventListener('seeked',done);video.removeEventListener('error',fail);resolve();},fail=()=>{video.removeEventListener('seeked',done);reject(Error('无法回到视频首帧'));};video.addEventListener('seeked',done,{once:true});video.addEventListener('error',fail,{once:true});video.currentTime=0;});
}
function renderSamCandidate(index){
  const masks=localSam.masks,dims=localSam.maskDims;if(!masks||!dims)return;
  const count=dims[1]||1,height=dims[dims.length-2],width=dims[dims.length-1],plane=width*height,start=Math.min(index,count-1)*plane;
  const source=document.createElement('canvas');source.width=width;source.height=height;
  const image=source.getContext('2d').createImageData(width,height);
  for(let p=0;p<plane;p++)if(masks[start+p]>0)image.data.set([61,229,206,130],p*4);
  source.getContext('2d').putImageData(image,0,0);
  const canvas=$('local-mask'),context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);context.imageSmoothingEnabled=true;context.drawImage(source,0,0,canvas.width,canvas.height);
  localSam.preview=true;syncLocalPreview();
  for(const button of $('local-sam-candidates').children)button.setAttribute('aria-pressed',String(Number(button.dataset.index)===index));
}
function setSamCandidates(){
  const holder=$('local-sam-candidates'),count=localSam.maskDims?.[1]||1;holder.replaceChildren();holder.hidden=false;
  const scores=localSam.scores||[];let best=0;for(let index=1;index<count;index++)if((scores[index]??-Infinity)>(scores[best]??-Infinity))best=index;
  for(let index=0;index<count;index++){const button=document.createElement('button');button.dataset.index=index;button.setAttribute('aria-pressed',String(index===best));button.textContent=`候选 ${index+1}${Number.isFinite(scores[index])?` · ${Math.round(scores[index]*100)}%`:''}`;button.onclick=()=>renderSamCandidate(index);holder.append(button);}
  renderSamCandidate(best);
}
async function loadLocalSam(){
  if(localSam.loaded)return;
  localSam.busy=true;$('local-sam-load').disabled=true;localSamStatus('正在启动端侧 SAM 2…');
  try{
    const report=await samRequest('load');await seekStart();present(0);
    const input=captureSamInput();await samRequest('encode',input,[input.pixels.buffer]);
    localSam.loaded=true;$('local-sam-load').textContent=`已编码首帧（${report.device}）`;$('local-sam-mode').disabled=false;localSamStatus('首帧已编码。启用“使用本地点选”后，点击画面生成本地候选。');
  }catch(error){$('local-sam-load').disabled=false;localSamStatus(error.message,true);throw error;}finally{localSam.busy=false;}
}
async function segmentLocalPoint(point){
  if(!localSam.loaded){localSamStatus('请先加载并编码首帧。',true);return;}
  if(localSam.busy)return;
  localSam.busy=true;video.pause();await seekStart();present(0);
  try{
    const result=await samRequest('decode',{x:point.x*1024,y:point.y*1024});localSam.masks=result.masks;localSam.maskDims=result.maskDims;localSam.scores=result.scores;setSamCandidates();localSamStatus('已生成首帧候选。它只用于检查点选质量，尚未传播到后续帧或替换已有跟踪结果。');
  }finally{localSam.busy=false;}
}
function syncControls(){
  $('editing-target').textContent=label(sequence.selectedId);$('hex').value=state.color.toUpperCase();$('color-preview').style.background=state.color;wheel.setColor(state.color);
  for(const [id,format] of [['amount',v=>`${Math.round(v*100)}%`],['lightness',v=>v.toFixed(2)],['threshold',v=>v.toFixed(2)]]){$(id).value=state[id];$(id+'-value').value=format(state[id]);}
  for(const button of $('swatches').children)button.classList.toggle('selected',button.dataset.color===state.color.toLowerCase());
  for(const button of $('targets').children){const id=Number(button.dataset.id),edit=edits.values.get(id);button.setAttribute('aria-pressed',String(id===sequence.selectedId));button.querySelector('.target-swatch').style.background=edit?.color||'';button.querySelector('.target-note').textContent=edit?'已调色':'原色';}
  $('reset').disabled=!edits.values.has(sequence.selectedId);$('reset-all').disabled=edits.values.size===0;
}
function select(id,flash=true){sequence.select(id);Object.assign(state,edits.get(id));syncControls();if(flash)outlineUntil=performance.now()+700;draw();status(`正在编辑${label(id)}，其他目标的修改会保留。`);}
function updateEdit(){edits.set(sequence.selectedId,state);persist();syncControls();draw();}
function setColor(hex){if(!/^#[\da-f]{6}$/i.test(hex)||!ready)return;state.color=hex.toLowerCase();updateEdit();}
function outline(){
  const visible=ready&&state.view!==2&&state.view!==3&&(outlineEnabled||performance.now()<outlineUntil);$('outline').hidden=!visible;
  if(!visible)return;
  const w=sample.width,h=sample.height,canvas=$('outline');if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  const mask=sequence.maskAt(Math.max(0,frame)),ctx=canvas.getContext('2d'),image=ctx.createImageData(w,h);
  for(let p=0;p<mask.length;p++)if(mask[p]){const x=p%w,y=Math.floor(p/w);if(x===0||y===0||x===w-1||y===h-1||!mask[p-1]||!mask[p+1]||!mask[p-w]||!mask[p+w])image.data.set([212,242,161,255],p*4);}
  ctx.putImageData(image,0,0);
}
function draw(){
  if(!ready||frame<0)return;
  const keys=[...edits.values.keys()].sort((a,b)=>a-b).join(',');
  if(layerFrame!==frame||layerKeys!==keys){layers=frameLayers(sequence,frame,edits);renderer.setLayerMasks(layers);layerFrame=frame;layerKeys=keys;}
  renderer.setMask(sequence.maskAt(frame),sample.width,sample.height);
  renderer.draw(state,layers.map(layer=>({id:layer.id,...edits.get(layer.id)})));outline();
}
function present(index){
  if(!ready||video.readyState<2||video.seeking)return;
  frame=Math.min(sample.frame_count-1,Math.max(0,index));renderer.setFrame(video,sample.width,sample.height);draw();syncLocalPreview();
}
function observe(mediaTime){if(lastMediaTime>=0&&mediaTime+.001<lastMediaTime&&video.loop&&!video.paused&&lastMediaTime>video.duration-.25&&mediaTime<.25){cycles++;$('loop').dataset.cycles=String(cycles);}lastMediaTime=mediaTime;}
function onVideoFrame(_,metadata){observe(metadata.mediaTime);present(Math.round(metadata.mediaTime*sample.fps));video.requestVideoFrameCallback(onVideoFrame);}
function tick(now){
  if(ready){
    if(!hasVideoFrames&&video.readyState>=2&&!video.seeking){observe(video.currentTime);const index=Math.min(sample.frame_count-1,Math.floor(video.currentTime*sample.fps+1e-4));if(index!==frame)present(index);}
    if(!outlineEnabled&&now>=outlineUntil)$('outline').hidden=true;
    if(now-lastTimeUI>120){lastTimeUI=now;$('time').textContent=`${time(video.currentTime)} / ${time(video.duration)}`;if(!video.seeking)$('seek').value=video.currentTime;}
  }
  requestAnimationFrame(tick);
}
$('output').onclick=safe(async event=>{
  if(!ready||frame<0)return;
  const box=renderer.canvas.getBoundingClientRect(),scale=Math.min(box.width/sample.width,box.height/sample.height),w=sample.width*scale,h=sample.height*scale;
  const point={x:(event.clientX-box.left-(box.width-w)/2)/w,y:(event.clientY-box.top-(box.height-h)/2)/h};
  if(point.x<0||point.y<0||point.x>1||point.y>1)return;
  if(localSam.active){await segmentLocalPoint(point);return;}
  const targets=[...sequence.ids].map(id=>({kind:'tracked',id,mask:sequence.maskForObject(frame,id)}));
  const hit=rankPointMasks(targets,sample.width,sample.height,point)[0];
  if(hit)select(hit.id);else status('此示例可编辑衬衫、外套和右侧柔光箱，请点目标内部。');
});
$('play').onclick=safe(async()=>{if(video.paused){if(video.ended)video.currentTime=0;await video.play();}else video.pause();});
video.onplay=()=>{$('play').textContent='暂停';syncLocalPreview();};video.onpause=()=>{$('play').textContent='播放';syncLocalPreview();};video.onended=()=>{$('play').textContent='播放';syncLocalPreview();};
$('loop').onclick=()=>{video.loop=!video.loop;$('loop').setAttribute('aria-pressed',String(video.loop));};
$('seek').oninput=()=>{video.currentTime=Number($('seek').value);};video.addEventListener('seeked',()=>{if(!hasVideoFrames)present(Math.floor(video.currentTime*sample.fps));});
$('hex').oninput=()=>{if(/^#[\da-f]{6}$/i.test($('hex').value))setColor($('hex').value);};$('hex').onchange=()=>{if(/^#[\da-f]{6}$/i.test($('hex').value))setColor($('hex').value);else{$('hex').value=state.color.toUpperCase();status('请输入 #RRGGBB 格式的颜色。',true);}};
for(const id of ['amount','lightness','threshold'])$(id).oninput=()=>{if(!ready)return;state[id]=Number($(id).value);updateEdit();};
$('reset').onclick=()=>{if(!ready)return;edits.remove(sequence.selectedId);persist();select(sequence.selectedId,false);};
$('reset-all').onclick=()=>{if(!ready)return;edits.clear();persist();select(sequence.selectedId,false);status('已还原所有目标的原色。');};
$('toggle-outline').onclick=()=>{outlineEnabled=!outlineEnabled;$('toggle-outline').setAttribute('aria-pressed',String(outlineEnabled));outlineUntil=0;outline();};
$('local-sam-load').onclick=safe(loadLocalSam);
$('local-sam-mode').onclick=()=>{localSam.active=!localSam.active;$('local-sam-mode').setAttribute('aria-pressed',String(localSam.active));$('local-sam-mode').textContent=localSam.active?'本地点选已启用':'使用本地点选';localSamStatus(localSam.active?'请在视频上点选。页面会暂停在首帧并显示本地候选。':'已恢复使用已缓存的逐帧目标。');};
const views={edit:0,split:1,mask:2,original:3};for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{state.view=views[button.dataset.view];for(const item of document.querySelectorAll('[data-view]'))item.setAttribute('aria-pressed',String(item===button));$('split-controls').hidden=state.view!==1;draw();};
$('split').oninput=()=>{state.split=Number($('split').value);$('split-value').value=`${Math.round(state.split*100)}%`;draw();};
$('snapshot').onclick=safe(async()=>{draw();const blob=await new Promise(resolve=>renderer.canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('当前画面无法保存');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`recolor-example-${video.currentTime.toFixed(2)}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
document.addEventListener('gpu-lost',()=>status('绘图设备已断开，请刷新页面重新载入示例。',true));
try{
  const response=await fetch('./assets/example-tracks.json');if(!response.ok)throw Error('示例跟踪数据未找到。');sample=await response.json();
  sequence=new FalObjectSequence(sample.objects,sample.frame_count,sample.width,sample.height);if(!sequence.ids.size)throw Error('示例没有可编辑目标。');
  renderer=await createRenderer($('output'));$('renderer-label').textContent=renderer.name;
  for(const id of sequence.ids){const button=document.createElement('button');button.className='target-button';button.dataset.id=id;button.innerHTML='<span class="target-name"></span><span class="target-state"><span class="target-swatch"></span><span class="target-note"></span></span>';button.querySelector('.target-name').textContent=label(id);button.onclick=()=>select(id);$('targets').append(button);}
  for(const color of ['#6e89e8','#cc5f4f','#b4c894','#e9b54a','#c58ba8','#6daaa0','#ddd8cb']){const button=document.createElement('button');button.style.background=color;button.dataset.color=color;button.setAttribute('aria-label',`换成 ${color}`);button.onclick=()=>setColor(color);$('swatches').append(button);}
  wheel=new ColorWheel($('color-wheel'),$('wheel-cursor'),$('wheel-value'),setColor);
  try{edits.restore(JSON.parse(sessionStorage.getItem(storageKey)||sessionStorage.getItem(legacyStorageKey)||'[]'),sequence.ids);}catch{}
  await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(Error('示例视频无法播放，请通过本地 HTTP 服务打开页面。'));video.src=sample.video_url;video.load();});
  ready=true;sequence.select([...sequence.ids][0]);Object.assign(state,edits.get(sequence.selectedId));syncControls();persist();$('loading').hidden=true;
  $('play').disabled=false;$('snapshot').disabled=false;$('seek').disabled=false;$('seek').max=video.duration;
  present(0);if(hasVideoFrames)video.requestVideoFrameCallback(onVideoFrame);requestAnimationFrame(tick);
  status('点选衬衫、外套或右侧柔光箱，调色时会保留其他目标的修改。');
  try{await video.play();}catch{/* A browser may require the play button before autoplay. */}
}catch(error){$('loading').textContent='示例载入失败';status(error.message,true);console.error(error);}
