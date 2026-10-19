/** Same-tick captures of the real host and child view, placed at the actual child bounds. */
export function compositeWorkspacePixels(host: { width:number;height:number;bitmap:Uint8Array }, child: { width:number;height:number;bitmap:Uint8Array }, rect: {x:number;y:number;width:number;height:number}) {
  for (const item of [host,child]) if(!Number.isInteger(item.width)||!Number.isInteger(item.height)||item.width<1||item.height<1||item.bitmap.length!==item.width*item.height*4)throw new Error('INVALID_BITMAP');
  if(![rect.x,rect.y,rect.width,rect.height].every(Number.isInteger)||rect.x<0||rect.y<0||rect.width!==child.width||rect.height!==child.height||rect.x+rect.width>host.width||rect.y+rect.height>host.height)throw new Error('CHILD_OUTSIDE_HOST');
  const result=Buffer.from(host.bitmap);for(let row=0;row<child.height;row++){const from=row*child.width*4;result.set(child.bitmap.subarray(from,from+child.width*4),((row+rect.y)*host.width+rect.x)*4);}return result;
}
