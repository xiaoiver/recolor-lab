import {decodeFrame} from './rle.js';
export function rankPointMasks(targets,width,height,point){
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.x>1||point.y<0||point.y>1)return [];
  const pixel=Math.min(height-1,Math.floor(point.y*height))*width+Math.min(width-1,Math.floor(point.x*width));
  return targets.filter(target=>target.mask[pixel]>0).map(target=>({...target,area:target.mask.reduce((sum,value)=>sum+(value>0),0)}))
    .sort((a,b)=>a.area-b.area||(a.kind==='tracked'?-1:0)-(b.kind==='tracked'?-1:0)||String(a.id).localeCompare(String(b.id)));
}
export function hitRegions(regions,width,height,point,getMask=r=>decodeFrame(r.rle,width,height)){
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.x>1||point.y<0||point.y>1)return [];
  const pixel=Math.min(height-1,Math.floor(point.y*height))*width+Math.min(width-1,Math.floor(point.x*width));
  return regions.filter(region=>getMask(region)[pixel]>0).sort((a,b)=>a.area-b.area);
}
export function regionAnchor(region,width,height,mask=decodeFrame(region.rle,width,height)){
  const box=region.box,cx=(box[0]+box[2])/2,cy=(box[1]+box[3])/2;let best=-1,distance=Infinity;
  for(let p=0;p<mask.length;p++)if(mask[p]){const d=(p%width-cx)**2+(Math.floor(p/width)-cy)**2;if(d<distance){distance=d;best=p;}}
  if(best<0)throw Error('候选区域为空');
  return {x:(best%width+.5)/width,y:(Math.floor(best/width)+.5)/height};
}
export function maskIoU(a,b){let intersection=0,union=0;for(let i=0;i<a.length;i++){intersection+=Boolean(a[i]&&b[i]);union+=Boolean(a[i]||b[i]);}return union?intersection/union:0;}

export function isRegionAncestor(regions,ancestorId,regionId){
  const byId=new Map(regions.map(region=>[region.id,region])),seen=new Set();let region=byId.get(regionId);
  while(region?.parent_id&&!seen.has(region.id)){
    seen.add(region.id);if(region.parent_id===ancestorId)return true;region=byId.get(region.parent_id);
  }
  return false;
}
