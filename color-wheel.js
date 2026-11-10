export function hsvToHex(h,s,v){
  h=((h%360)+360)%360;s=Math.max(0,Math.min(1,s));v=Math.max(0,Math.min(1,v));
  const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;
  const rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return '#'+rgb.map(channel=>Math.round((channel+m)*255).toString(16).padStart(2,'0')).join('');
}
export function hexToHsv(hex){
  const [r,g,b]=hex.match(/[\da-f]{2}/gi).map(x=>parseInt(x,16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  let h=d===0?0:max===r?60*((g-b)/d%6):max===g?60*((b-r)/d+2):60*((r-g)/d+4);
  return {h:(h+360)%360,s:max===0?0:d/max,v:max};
}
export function wheelPoint(x,y){return {h:(Math.atan2(y,x)*180/Math.PI+360)%360,s:Math.min(1,Math.hypot(x,y))};}

export class ColorWheel{
  constructor(canvas,cursor,value,onChange){
    this.canvas=canvas;this.cursor=cursor;this.value=value;this.onChange=onChange;this.hsv=hexToHsv('#6e89e8');this.renderDisc();
    const pick=event=>{const r=canvas.getBoundingClientRect();const p=wheelPoint((event.clientX-r.left-r.width/2)/(r.width/2),(event.clientY-r.top-r.height/2)/(r.height/2));this.hsv={...this.hsv,...p};this.emit();};
    canvas.addEventListener('pointerdown',event=>{event.preventDefault();canvas.focus();canvas.setPointerCapture(event.pointerId);pick(event);});
    canvas.addEventListener('pointermove',event=>{if(canvas.hasPointerCapture(event.pointerId))pick(event);});
    canvas.addEventListener('pointerup',event=>{if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);});
    canvas.addEventListener('keydown',event=>{const step=event.shiftKey?10:1;if(event.key==='ArrowLeft')this.hsv.h-=step;else if(event.key==='ArrowRight')this.hsv.h+=step;else if(event.key==='ArrowUp')this.hsv.s=Math.min(1,this.hsv.s+step/100);else if(event.key==='ArrowDown')this.hsv.s=Math.max(0,this.hsv.s-step/100);else return;event.preventDefault();this.emit();});
    value.addEventListener('input',()=>{this.hsv.v=Number(value.value)/100;this.emit();});
    this.setColor('#6e89e8');
  }
  renderDisc(){
    const n=this.canvas.width,r=n/2,ctx=this.canvas.getContext('2d'),image=ctx.createImageData(n,n);
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){const dx=(x+.5-r)/r,dy=(y+.5-r)/r,d=Math.hypot(dx,dy);if(d>1)continue;const p=wheelPoint(dx,dy),hex=hsvToHex(p.h,p.s,1),i=(y*n+x)*4;image.data[i]=parseInt(hex.slice(1,3),16);image.data[i+1]=parseInt(hex.slice(3,5),16);image.data[i+2]=parseInt(hex.slice(5,7),16);image.data[i+3]=Math.min(255,(1-d)*r*255);}
    ctx.putImageData(image,0,0);
  }
  emit(){const hex=hsvToHex(this.hsv.h,this.hsv.s,this.hsv.v);this.update(hex);this.onChange(hex);}
  setColor(hex){const next=hexToHsv(hex);if(next.s===0)next.h=this.hsv.h;this.hsv=next;this.update(hex);}
  update(hex){
    const h=this.hsv.h*Math.PI/180;this.cursor.style.left=`${50+49*this.hsv.s*Math.cos(h)}%`;this.cursor.style.top=`${50+49*this.hsv.s*Math.sin(h)}%`;this.cursor.style.background=hex;
    this.value.value=Math.round(this.hsv.v*100);this.value.style.background=`linear-gradient(to right,#000,${hsvToHex(this.hsv.h,this.hsv.s,1)})`;
    this.canvas.setAttribute('aria-valuenow',Math.round((this.hsv.h+360)%360));this.canvas.setAttribute('aria-valuetext',`${hex.toUpperCase()}，饱和度 ${Math.round(this.hsv.s*100)}%`);
  }
}
