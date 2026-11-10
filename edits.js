export const DEFAULT_EDIT=Object.freeze({color:'#6e89e8',amount:1,lightness:0,threshold:.5});

export class ObjectEdits{
  constructor(){this.values=new Map();}
  get(id){return {...DEFAULT_EDIT,...this.values.get(id)};}
  set(id,settings){
    if(!Number.isSafeInteger(id))throw Error('无效的服装目标');
    const edit={...DEFAULT_EDIT,...settings};
    if(!/^#[\da-f]{6}$/i.test(edit.color)||!Number.isFinite(edit.amount)||edit.amount<0||edit.amount>1||!Number.isFinite(edit.lightness)||Math.abs(edit.lightness)>.25||!Number.isFinite(edit.threshold)||edit.threshold<.1||edit.threshold>.9)throw Error('颜色参数无效');
    this.values.set(id,{color:edit.color,amount:edit.amount,lightness:edit.lightness,threshold:edit.threshold});
  }
  remove(id){this.values.delete(id);}
  clear(){this.values.clear();}
  toJSON(){return [...this.values];}
  restore(data,ids){this.clear();if(!Array.isArray(data))return;for(const entry of data){try{if(Array.isArray(entry)&&ids.has(entry[0]))this.set(entry[0],entry[1]);}catch{/* Ignore stale or invalid saved controls. */}}}
}

// Draw broad garments first and small garments last. The order is independent
// of which item is selected, so selecting another object never changes overlap.
export function frameLayers(sequence,index,edits){
  const objects=sequence.frames[index]||[];
  return objects.filter(object=>edits.values.has(object.object_id)).map(object=>{
    const mask=sequence.maskForObject(index,object.object_id);
    return {id:object.object_id,mask,width:sequence.width,height:sequence.height,area:mask.reduce((sum,v)=>sum+(v>0),0)};
  }).sort((a,b)=>b.area-a.area||a.id-b.id);
}
