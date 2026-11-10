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
const hasVideoFrames=typeof video.requestVideoFrameCallback==='function';
const status=(text,error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error);};
const safe=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(error=>{status(error.message,true);console.error(error);});
function label(id){return sample.labels[id]||`目标 ${id+1}`;}
function persist(){try{sessionStorage.setItem(storageKey,JSON.stringify(edits.toJSON()));}catch{}}
function time(value){return `${Math.floor((value||0)/60).toString().padStart(2,'0')}:${Math.floor((value||0)%60).toString().padStart(2,'0')}`;}
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
  frame=Math.min(sample.frame_count-1,Math.max(0,index));renderer.setFrame(video,sample.width,sample.height);draw();
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
$('output').onclick=safe(event=>{
  if(!ready||frame<0)return;
  const box=renderer.canvas.getBoundingClientRect(),scale=Math.min(box.width/sample.width,box.height/sample.height),w=sample.width*scale,h=sample.height*scale;
  const point={x:(event.clientX-box.left-(box.width-w)/2)/w,y:(event.clientY-box.top-(box.height-h)/2)/h};
  if(point.x<0||point.y<0||point.x>1||point.y>1)return;
  const targets=[...sequence.ids].map(id=>({kind:'tracked',id,mask:sequence.maskForObject(frame,id)}));
  const hit=rankPointMasks(targets,sample.width,sample.height,point)[0];
  if(hit)select(hit.id);else status('此示例可编辑衬衫、外套和右侧柔光箱，请点目标内部。');
});
$('play').onclick=safe(async()=>{if(video.paused){if(video.ended)video.currentTime=0;await video.play();}else video.pause();});
video.onplay=()=>{$('play').textContent='暂停';};video.onpause=()=>{$('play').textContent='播放';};video.onended=()=>{$('play').textContent='播放';};
$('loop').onclick=()=>{video.loop=!video.loop;$('loop').setAttribute('aria-pressed',String(video.loop));};
$('seek').oninput=()=>{video.currentTime=Number($('seek').value);};video.addEventListener('seeked',()=>{if(!hasVideoFrames)present(Math.floor(video.currentTime*sample.fps));});
$('hex').oninput=()=>{if(/^#[\da-f]{6}$/i.test($('hex').value))setColor($('hex').value);};$('hex').onchange=()=>{if(/^#[\da-f]{6}$/i.test($('hex').value))setColor($('hex').value);else{$('hex').value=state.color.toUpperCase();status('请输入 #RRGGBB 格式的颜色。',true);}};
for(const id of ['amount','lightness','threshold'])$(id).oninput=()=>{if(!ready)return;state[id]=Number($(id).value);updateEdit();};
$('reset').onclick=()=>{if(!ready)return;edits.remove(sequence.selectedId);persist();select(sequence.selectedId,false);};
$('reset-all').onclick=()=>{if(!ready)return;edits.clear();persist();select(sequence.selectedId,false);status('已还原所有目标的原色。');};
$('toggle-outline').onclick=()=>{outlineEnabled=!outlineEnabled;$('toggle-outline').setAttribute('aria-pressed',String(outlineEnabled));outlineUntil=0;outline();};
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
