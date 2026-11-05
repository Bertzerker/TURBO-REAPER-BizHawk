// SPDX-License-Identifier: MIT — one atlas upload, optional viewport crop.
export class AtlasRenderer {
 constructor(canvas,onChange){this.canvas=canvas;this.onChange=onChange;this.mode='unavailable';this.reason='';this.region=null;this.gl=null;this.ctx=null;this.width=0;this.height=0;this.initialize();}
 initialize(){
  try{this.gl=this.canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});if(!this.gl)throw Error('WebGL is unavailable');
   const gl=this.gl,shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
   const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 uv;uniform vec4 crop;void main(){vec2 t=(p+1.0)*0.5;t.y=1.0-t.y;uv=crop.xy+t*crop.zw;gl_Position=vec4(p,0,1);}'));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision mediump float;varying vec2 uv;uniform sampler2D tex;void main(){vec4 c=texture2D(tex,uv);float ck=mod(floor(gl_FragCoord.x/8.0)+floor(gl_FragCoord.y/8.0),2.0);vec3 bg=mix(vec3(0.12),vec3(0.18),ck);gl_FragColor=vec4(mix(bg,c.bgr,c.a),1.0);}'));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Shader link failed');gl.useProgram(program);
   const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);const attr=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);this.crop=gl.getUniformLocation(program,'crop');gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());for(const [p,v]of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,p,v);this.mode='WebGL';
   this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.fallback('WebGL context was lost');this.onChange?.();},{once:true});
  }catch(e){this.fallback(e.message);}
 }
 fallback(reason){
  this.reason=reason;this.gl=null;
  // A canvas that owned WebGL cannot switch context types; replace only it.
  const old=this.canvas,next=document.createElement('canvas');for(const a of old.attributes)next.setAttribute(a.name,a.value);old.replaceWith(next);this.canvas=next;
  try{this.ctx=next.getContext('2d',{alpha:false});if(!this.ctx)throw Error('Canvas 2D is also unavailable');this.mode='Canvas 2D';this.width=0;this.height=0;}catch(e){this.mode='unavailable';this.reason+='; '+e.message;}
 }
 draw(s,view='all'){
  const a=s.meta.atlas,p=view==='all'?{x:0,y:0,width:a.width,height:a.height}:a.panels.find(p=>p.view===view)??a.panels[0];this.region=p;
  const canvas=this.canvas;if(canvas.width!==p.width||canvas.height!==p.height){canvas.width=p.width;canvas.height=p.height;}
  const bytes=s.bytes.subarray(a.offset,a.offset+a.length);
  if(this.gl){const gl=this.gl;gl.viewport(0,0,p.width,p.height);if(this.width!==a.width||this.height!==a.height){this.width=a.width;this.height=a.height;gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,a.width,a.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);}gl.uniform4f(this.crop,p.x/a.width,p.y/a.height,p.width/a.width,p.height/a.height);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,a.width,a.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);}
  else if(this.ctx){if(!this.image||this.image.width!==p.width||this.image.height!==p.height)this.image=new ImageData(p.width,p.height);const out=this.image.data;for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){const src=((p.y+y)*a.width+p.x+x)*4,dst=(y*p.width+x)*4;const checker=((x>>3)+(y>>3))%2?46:31,alpha=bytes[src+3]/255;out[dst]=bytes[src+2]*alpha+checker*(1-alpha);out[dst+1]=bytes[src+1]*alpha+checker*(1-alpha);out[dst+2]=bytes[src]*alpha+checker*(1-alpha);out[dst+3]=255;}this.ctx.putImageData(this.image,0,0);}
 }
 point(event){const r=this.canvas.getBoundingClientRect(),p=this.region;if(!p||!r.width||!r.height)return null;return {x:p.x+Math.floor((event.clientX-r.left)*p.width/r.width),y:p.y+Math.floor((event.clientY-r.top)*p.height/r.height)};}
}
