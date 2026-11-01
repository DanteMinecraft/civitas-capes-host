let csrf=null;
const $=id=>document.getElementById(id);
async function api(url,options={}) {
  const headers={...(options.headers||{})}; if(csrf) headers['X-Civitas-CSRF']=csrf;
  const r=await fetch(url,{...options,headers,credentials:'same-origin'});
  const data=await r.json().catch(()=>({error:'Unexpected server response'}));
  if(!r.ok) throw new Error(data.error||`HTTP ${r.status}`); return data;
}
function status(id,msg,good=true){$(id).textContent=msg;$(id).className='status '+(good?'good':'error');}
async function load(){
 const d=await api('/api/data'); $('capesJson').value=JSON.stringify(d.capes,null,2); $('playersJson').value=JSON.stringify(d.players,null,2);
 $('capeCount').textContent=d.capes.capes.length; $('playerCount').textContent=d.players.players.length;
}
async function check(){const s=await fetch('/api/session',{credentials:'same-origin'}).then(r=>r.json()); if(s.authenticated){csrf=s.csrf;$('login').hidden=true;$('app').hidden=false;await load();}}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginError').textContent='';try{const d=await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('password').value})});csrf=d.csrf;$('password').value='';$('login').hidden=true;$('app').hidden=false;await load();}catch(e){$('loginError').textContent=e.message;}});
$('logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'});}finally{csrf=null;location.reload();}};
$('refresh').onclick=()=>load().catch(e=>alert(e.message));
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));$('capes').hidden=b.dataset.tab!=='capes';$('players').hidden=b.dataset.tab!=='players';});
$('saveCapes').onclick=async()=>{try{const x=JSON.parse($('capesJson').value);await api('/api/capes',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(x)});status('capesStatus','Saved successfully.');await load();}catch(e){status('capesStatus',e.message,false);}};
$('savePlayers').onclick=async()=>{try{const x=JSON.parse($('playersJson').value);await api('/api/players',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(x)});status('playersStatus','Saved successfully.');await load();}catch(e){status('playersStatus',e.message,false);}};
$('upload').onclick=async()=>{const f=$('file').files[0];if(!f)return status('uploadResult','Choose an image first.',false);const name=$('fileName').value.trim()||f.name;try{const r=await api('/api/upload',{method:'POST',headers:{'Content-Type':f.type,'X-File-Name':name},body:f});$('uploadResult').textContent=`Uploaded. Public URL: ${r.url} — add this URL to the cape catalog.`;}catch(e){status('uploadResult',e.message,false);}};
check().catch(e=>console.error(e));