// Original synthetic presentation maps; no geographic or external source.
import * as THREE from 'three/webgpu';
export const BUILDING_MAP_SIZE=256;
const clamp=v=>Math.max(0,Math.min(255,Math.round(v)));
const tau=Math.PI*2;
function noise(x,y){let h=Math.imul(x+1,374761393)^Math.imul(y+1,668265263);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295-0.5;}
export function generateBuildingMaps(kind){
  if(!['plaster','standing-seam'].includes(kind))throw Error('BUILDING_MAP_KIND_INVALID');
  const size=BUILDING_MAP_SIZE,plaster=kind==='plaster';
  const height=new Float32Array(size*size),diffuse=new Uint8Array(size*size*4),normal_gl=new Uint8Array(diffuse.length),roughness=new Uint8Array(diffuse.length);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=y*size+x,grain=noise(x,y),wave=Math.sin(tau*x/size*3)*Math.cos(tau*y/size*4),seam=Math.pow(0.5+0.5*Math.cos(tau*x/size*8),32);
    height[i]=plaster?grain*.32+wave*.1:seam*1.6+grain*.045;
    const c=clamp(plaster?230+grain*21+wave*8:217-seam*33+grain*9),r=clamp(plaster?232+grain*15:129+seam*24+grain*10);
    diffuse.set([c,c,c,255],i*4);roughness.set([r,r,r,255],i*4);
  }
  const at=(x,y)=>height[((y+size)%size)*size+((x+size)%size)];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const dx=(at(x-1,y)-at(x+1,y))*.5,dy=(at(x,y-1)-at(x,y+1))*.5,len=Math.hypot(dx,dy,1);
    normal_gl.set([clamp(127.5+127.5*dx/len),clamp(127.5+127.5*dy/len),clamp(127.5+127.5/len),255],(y*size+x)*4);
  }
  return {diffuse,normal_gl,roughness};
}
export function createProceduralBuildingTextures(kind,{normalMaps=true,anisotropy=1}={}){
  return Object.fromEntries(Object.entries(generateBuildingMaps(kind)).filter(([key])=>normalMaps||key!=='normal_gl').map(([key,data])=>{
    const texture=new THREE.DataTexture(data,BUILDING_MAP_SIZE,BUILDING_MAP_SIZE,THREE.RGBAFormat);
    texture.name='NWE:procedural:'+kind+':'+key;texture.colorSpace=key==='diffuse'?THREE.SRGBColorSpace:THREE.NoColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.anisotropy=anisotropy;texture.needsUpdate=true;
    return [key,texture];
  }));
}
