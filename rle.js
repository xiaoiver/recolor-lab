// COCO RLE uses column-major order. Decode one frame at a time to bound memory.
export function countsFromString(text){
  const counts=[];let p=0;
  while(p<text.length){let value=0,shift=0,more=true,c=0;
    while(more){if(p>=text.length||shift>50)throw Error('无效的 COCO RLE 编码');c=text.charCodeAt(p++)-48;if(c<0||c>63)throw Error('无效的 COCO RLE 字符');value+=(c&31)*2**shift;more=Boolean(c&32);shift+=5;}
    if(c&16)value-=2**shift;
    if(counts.length>2)value+=counts[counts.length-2];
    if(!Number.isSafeInteger(value)||value<0)throw Error('无效的 COCO RLE 长度');counts.push(value);
  }return counts;
}
export function parseFrame(value,expectedWidth,expectedHeight){
  if(typeof value==='string'){
    if(value==='')return [];
    if(!value.startsWith('{')&&!value.startsWith('['))return [{size:[expectedHeight,expectedWidth],counts:value}];
    try{value=JSON.parse(value);}catch{throw Error('RLE JSON 格式无效。');}
  }
  if(value===null)return [];
  if(Array.isArray(value))return value.flatMap(v=>parseFrame(v,expectedWidth,expectedHeight));
  if(value&&Array.isArray(value.size)&&(typeof value.counts==='string'||Array.isArray(value.counts)))return [value];
  if(value?.rle!==undefined)return parseFrame(value.rle,expectedWidth,expectedHeight);
  throw Error('暂不支持这个 RLE 帧结构；请保留 .cache 中的原始结果供适配。');
}
export function decodeFrame(frame,expectedWidth,expectedHeight){
  // fal's observed /video-rle response uses space-separated, one-based start/length
  // pairs over row-major pixels, rather than COCO's alternating column-major runs.
  if(typeof frame==='string'&&/^\d+\s+\d+(?:\s+\d+)*$/.test(frame.trim())){
    const values=frame.trim().split(/\s+/).map(Number),output=new Uint8Array(expectedWidth*expectedHeight);
    if(values.length%2)throw Error('fal RLE 的起点/长度不成对');
    let previousEnd=0;
    for(let i=0;i<values.length;i+=2){const start=values[i]-1,length=values[i+1],end=start+length;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||start<previousEnd||length<1||end>output.length)throw Error('fal RLE 的起点或长度越界');output.fill(255,start,end);previousEnd=end;}
    return output;
  }
  const objects=parseFrame(frame,expectedWidth,expectedHeight),output=new Uint8Array(expectedWidth*expectedHeight);
  for(const object of objects){const [h,w]=object.size;if(w!==expectedWidth||h!==expectedHeight)throw Error(`Mask 尺寸 ${w}×${h} 与代理 ${expectedWidth}×${expectedHeight} 不一致，停止合成以避免错位。`);
    const counts=typeof object.counts==='string'?countsFromString(object.counts):object.counts;
    let offset=0,foreground=false;
    for(const run of counts){if(!Number.isSafeInteger(run)||run<0||offset+run>w*h)throw Error('RLE 长度越界');if(foreground){for(let p=offset;p<offset+run;p++){const x=Math.floor(p/h),y=p%h;output[y*w+x]=255;}}offset+=run;foreground=!foreground;}
    if(offset!==w*h)throw Error('RLE 总长度与帧尺寸不一致');
  }return output;
}
export function validateSequence(frames,count,w,h){
  if(!Array.isArray(frames)||frames.length!==count)throw Error(`fal 返回 ${frames?.length??'?'} 个 mask，代理有 ${count} 帧。未确认时间对应关系，停止合成。`);
  // Validate every frame before playback; keep only encoded RLEs afterwards.
  for(const frame of frames)decodeFrame(frame,w,h);
  return frames;
}

// Observed fal video RLE is temporally XOR encoded: frame 0 is full, later
// start/length pairs flip changed pixels; an empty string means no changes.
export class FalMaskSequence{
  constructor(frames,count,width,height){
    if(!Array.isArray(frames)||frames.length!==count)throw Error(`fal 返回 ${frames?.length??'?'} 个 mask，代理有 ${count} 帧。停止合成。`);
    this.width=width;this.height=height;this.checkpoints=new Map();this.hasForeground=false;
    const size=width*height;
    this.runs=frames.map(frame=>{
      if(frame==='')return new Uint32Array(0);
      if(typeof frame!=='string'||!/^\d+\s+\d+(?:\s+\d+)*$/.test(frame.trim()))throw Error('fal 差分 RLE 格式已变化，停止合成，请核对原始返回。');
      const values=frame.trim().split(/\s+/).map(Number);if(values.length%2)throw Error('fal RLE 的起点/长度不成对');
      let end=0;
      for(let i=0;i<values.length;i+=2){const start=values[i]-1,n=values[i+1];if(!Number.isSafeInteger(start)||!Number.isSafeInteger(n)||start<end||n<1||start+n>size)throw Error('fal 差分 RLE 越界');values[i]=start;end=start+n;}
      return Uint32Array.from(values);
    });
    this.mask=new Uint8Array(size);
    for(let i=0;i<count;i++){this.apply(i);if(i%24===0)this.checkpoints.set(i,this.mask.slice());if(this.runs[i].length)this.hasForeground=true;}
    this.current=0;this.mask=this.checkpoints.get(0).slice();
  }
  apply(index){const runs=this.runs[index];for(let i=0;i<runs.length;i+=2){const end=runs[i]+runs[i+1];for(let p=runs[i];p<end;p++)this.mask[p]^=255;}}
  maskAt(index){
    if(!Number.isInteger(index)||index<0||index>=this.runs.length)throw Error('Mask 帧索引越界');
    const checkpoint=Math.floor(index/24)*24;
    if(index<this.current||checkpoint>this.current){this.mask=this.checkpoints.get(checkpoint).slice();this.current=checkpoint;}
    for(let i=this.current+1;i<=index;i++)this.apply(i);
    this.current=index;return this.mask;
  }
}

export class FalObjectSequence{
  constructor(frames,count,width,height,point=null){
    if(!Array.isArray(frames)||frames.length!==count)throw Error('独立对象 mask 帧数不匹配');
    this.frames=frames;this.width=width;this.height=height;this.selectedId=null;this.ids=new Set();this.lastIndex=-1;
    for(const frame of frames){if(!Array.isArray(frame))throw Error('独立对象 mask 格式无效');const seen=new Set();for(const object of frame){if(!Number.isSafeInteger(object.object_id)||seen.has(object.object_id)||typeof object.rle!=='string')throw Error('对象 ID 或 mask 格式无效');seen.add(object.object_id);this.ids.add(object.object_id);decodeFrame(object.rle,width,height);}}
    this.hasForeground=this.ids.size>0;
    if(point)this.selectAt(point);
    else{const first=frames.find(f=>f.length);if(first?.length===1)this.select(first[0].object_id);}
  }
  select(id){if(!this.ids.has(id))throw Error('选中的对象 ID 不存在');this.selectedId=id;this.lastIndex=-1;}
  selectAt(point){
    const index=Math.min(this.frames.length-1,Math.max(0,point.frame_index));
    const pixel=Math.min(this.height-1,Math.floor(point.y*this.height))*this.width+Math.min(this.width-1,Math.floor(point.x*this.width));
    const hits=[];
    for(const object of this.frames[index]){const mask=decodeFrame(object.rle,this.width,this.height);if(mask[pixel])hits.push({id:object.object_id,area:mask.reduce((sum,v)=>sum+(v>0),0)});}
    if(!hits.length){this.selectedId=null;this.lastIndex=-1;throw Error('这个点不在已识别的衣服候选内。请点衣服内部，或重新识别服装。');}
    hits.sort((a,b)=>a.area-b.area);this.select(hits[0].id);return this.selectedId;
  }
  maskAt(index){
    if(index===this.lastIndex)return this.lastMask;
    this.lastMask=this.maskForObject(index,this.selectedId);
    this.lastIndex=index;return this.lastMask;
  }
  maskForObject(index,id){const object=this.frames[index]?.find(o=>o.object_id===id);return object?decodeFrame(object.rle,this.width,this.height):new Uint8Array(this.width*this.height);}
}
