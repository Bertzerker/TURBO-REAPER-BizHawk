// SPDX-License-Identifier: MIT
import {marked} from 'marked';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'dark',htmlLabels:false,flowchart:{htmlLabels:false},maxTextSize:50000,maxEdges:300,suppressErrorRendering:true});
let sequence=0;
async function diagram(host,source){
 const {svg}=await mermaid.render('rea-note-diagram-'+(++sequence),source);
 host.innerHTML=DOMPurify.sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['foreignObject','a','script'],FORBID_ATTR:['href','xlink:href']});
}
export async function renderNote(host,format,body){
 host.replaceChildren();if(!body.trim()){host.textContent='Write a comment, then choose Preview.';return;}
 if(format==='json'){const pre=document.createElement('pre');pre.textContent=JSON.stringify(JSON.parse(body),null,2);host.append(pre);return;}
 if(format==='mermaid'){await diagram(host,body);return;}
 host.innerHTML=DOMPurify.sanitize(marked.parse(body),{FORBID_TAGS:['img','video','audio','iframe','form','style','svg','math'],FORBID_ATTR:['style']});
 for(const a of host.querySelectorAll('a')){a.rel='noopener noreferrer';a.target='_blank';}
 for(const code of host.querySelectorAll('code.language-json')){try{code.textContent=JSON.stringify(JSON.parse(code.textContent),null,2);}catch{const label=document.createElement('small');label.textContent='JSON block contains invalid JSON.';code.parentElement.before(label);}}
 const blocks=[...host.querySelectorAll('code.language-mermaid')];if(blocks.length>10)throw Error('Preview supports at most ten diagrams per comment.');
 for(const code of blocks){const holder=document.createElement('div');holder.className='note-diagram';const source=code.textContent;code.parentElement.replaceWith(holder);try{await diagram(holder,source);}catch(e){holder.textContent='Diagram error: '+e.message;}}
}
