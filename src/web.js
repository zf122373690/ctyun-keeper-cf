// web.js - 管理后台单页（暗色科技主题），由 Hono 在 GET / 返回
// 账号密码只经 KV 与后端交互，前端不持久化明文密码。

export const adminHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>天翼云电脑保活 · 管理后台</title>
<style>
  :root{
    --bg:#0b1120; --panel:#1a2332; --border:#25324a; --primary:#3b82f6;
    --primary-h:#2563eb; --text:#e2e8f0; --muted:#94a3b8;
    --danger:#ef4444; --ok:#22c55e; --warn:#f59e0b;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
    font-size:14px;line-height:1.5}
  .wrap{max-width:960px;margin:0 auto;padding:20px}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:var(--muted);font-size:13px;margin-bottom:18px}
  .panel{background:var(--panel);border:1px solid var(--border);border-radius:10px;
    padding:16px;margin-bottom:16px}
  .panel h2{font-size:15px;margin:0 0 12px;color:#cbd5e1;font-weight:600}
  label{display:block;color:var(--muted);font-size:12px;margin:8px 0 4px}
  input{width:100%;background:#0f172a;border:1px solid var(--border);border-radius:8px;
    color:var(--text);padding:9px 10px;font-size:14px;outline:none}
  input:focus{border-color:var(--primary)}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  .row>*{flex:1;min-width:160px}
  button{background:var(--primary);color:#fff;border:0;border-radius:8px;
    padding:9px 14px;font-size:14px;cursor:pointer;transition:.15s}
  button:hover{background:var(--primary-h)}
  button.ghost{background:transparent;border:1px solid var(--border);color:var(--text)}
  button.ghost:hover{background:#0f172a}
  button.danger{background:transparent;border:1px solid var(--danger);color:var(--danger)}
  button.danger:hover{background:rgba(239,68,68,.12)}
  .btnrow{display:flex;gap:8px;margin-top:12px;align-items:center}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--border)}
  th{color:var(--muted);font-weight:500;font-size:12px}
  td .acts{display:flex;gap:6px}
  td .acts button{padding:5px 10px;font-size:12px}
  .tag{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;
    background:#0f172a;border:1px solid var(--border);color:var(--muted)}
  .tag.ok{color:var(--ok);border-color:rgba(34,197,94,.4)}
  .tag.warn{color:var(--warn);border-color:rgba(245,158,11,.4)}
  .tag.err{color:var(--danger);border-color:rgba(239,68,68,.4)}
  #logBox{background:#0f172a;border:1px solid var(--border);border-radius:8px;
    height:300px;overflow:auto;padding:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:12px;white-space:pre-wrap;line-height:1.6}
  .log-line{margin:0}
  .log-info{color:#cbd5e1}
  .log-warn{color:var(--warn)}
  .log-error{color:var(--danger)}
  /* 登录层 */
  #login{position:fixed;inset:0;background:rgba(11,17,32,.96);display:flex;
    align-items:center;justify-content:center;z-index:50}
  .login-card{width:340px;background:var(--panel);border:1px solid var(--border);
    border-radius:12px;padding:24px}
  .login-card h2{margin:0 0 4px;font-size:18px}
  .hint{color:var(--muted);font-size:12px;margin:6px 0 14px}
  .err{color:var(--danger);font-size:12px;min-height:16px;margin-top:8px}
  .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
    background:var(--panel);border:1px solid var(--border);color:var(--text);
    padding:10px 16px;border-radius:8px;font-size:13px;opacity:0;transition:.25s;pointer-events:none}
  .toast.show{opacity:1}
  [hidden]{display:none!important}
</style>
</head>
<body>
  <div id="login">
    <div class="login-card">
      <h2>管理后台登录</h2>
      <div class="hint">请输入访问令牌（ADMIN_TOKEN）。由部署时 <code>wrangler secret put ADMIN_TOKEN</code> 设置。</div>
      <label>访问令牌</label>
      <input id="tokenInput" type="password" placeholder="ADMIN_TOKEN" autocomplete="off" />
      <div class="err" id="loginErr"></div>
      <div class="btnrow"><button id="loginBtn" style="flex:1">解锁</button></div>
    </div>
  </div>

  <div class="wrap" id="app" hidden>
    <h1>天翼云电脑保活</h1>
    <div class="sub">Cloudflare Workers · 网页管理后台 · 账号与日志均存于 KV</div>

    <div class="panel">
      <h2>保活设置</h2>
      <div class="row">
        <div>
          <label>保活时长（秒，建议 ≤ 55）</label>
          <input id="keepAliveSeconds" type="number" min="10" max="300" />
        </div>
      </div>
      <div class="btnrow">
        <button id="saveSettings">保存设置</button>
        <button id="runBtn" class="ghost">立即运行一次</button>
        <span id="runState" class="tag" style="margin-left:auto"></span>
      </div>
    </div>

    <div class="panel">
      <h2>账号列表</h2>
      <table>
        <thead><tr><th>名称</th><th>账号</th><th>密码</th><th>设备码</th><th>操作</th></tr></thead>
        <tbody id="accBody"></tbody>
      </table>
    </div>

    <div class="panel">
      <h2 id="formTitle">添加账号</h2>
      <div class="row">
        <div><label>名称（备注）</label><input id="f_name" placeholder="例如：店铺A" /></div>
        <div><label>账号（手机号/用户名）</label><input id="f_user" placeholder="user" /></div>
      </div>
      <div class="row">
        <div><label>密码</label><input id="f_password" type="password" placeholder="密码（编辑时留空=不变）" autocomplete="off" /></div>
        <div><label>设备码 deviceCode</label><input id="f_device" placeholder="留空则自动生成" /></div>
      </div>
      <div class="btnrow">
        <button id="saveAcc">保存账号</button>
        <button id="cancelEdit" class="ghost" hidden>取消编辑</button>
        <span id="accMsg" style="color:var(--muted);font-size:12px"></span>
      </div>
    </div>

    <div class="panel">
      <h2>执行日志</h2>
      <div id="logBox"></div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

<script>
(function(){
  var TOKEN_KEY='ctyun_admin_token';
  function getToken(){return localStorage.getItem(TOKEN_KEY)||'';}
  function setToken(t){localStorage.setItem(TOKEN_KEY,t);}
  function clearToken(){localStorage.removeItem(TOKEN_KEY);}
  function $(s){return document.querySelector(s);}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

  var editingId=null;
  var logTimer=null;

  function toast(msg){
    var t=$('#toast'); t.textContent=msg; t.classList.add('show');
    setTimeout(function(){t.classList.remove('show');},2200);
  }

  async function api(path,opts){
    opts=opts||{};
    var headers=Object.assign({},opts.headers||{},{'Authorization':'Bearer '+getToken()});
    var r=await fetch(path,Object.assign({},opts,{headers:headers}));
    if(r.status===401){
      clearToken();
      var em='令牌无效或缺失，请重新输入';
      try{var j=await r.json(); if(j&&j.error)em=j.error;}catch(e){}
      showLogin(em);
      throw new Error('unauthorized');
    }
    return r;
  }

  async function loadState(){
    var r=await api('/api/state');
    var d=await r.json();
    $('#keepAliveSeconds').value=d.keepAliveSeconds||55;
    renderAccounts(d.accounts||[]);
    renderLastRun(d.lastRun);
  }

  function renderAccounts(list){
    var tb=$('#accBody'); tb.innerHTML='';
    if(!list.length){
      tb.innerHTML='<tr><td colspan="5" style="color:var(--muted)">暂无账号，请在下方添加。</td></tr>';
      return;
    }
    list.forEach(function(a){
      var tr=document.createElement('tr');
      var pw=a.hasPassword?'<span class="tag ok">已设置</span>':'<span class="tag warn">未设置</span>';
      tr.innerHTML=
        '<td>'+esc(a.name)+'</td>'+
        '<td>'+esc(a.user)+'</td>'+
        '<td>'+pw+'</td>'+
        '<td>'+esc(a.deviceCode)+'</td>'+
        '<td><div class="acts">'+
          '<button class="ghost" data-edit="'+esc(a.id)+'">编辑</button>'+
          '<button class="danger" data-del="'+esc(a.id)+'">删除</button>'+
        '</div></td>';
      tb.appendChild(tr);
    });
    tb.querySelectorAll('[data-edit]').forEach(function(b){
      b.onclick=function(){startEdit(b.getAttribute('data-edit'));};
    });
    tb.querySelectorAll('[data-del]').forEach(function(b){
      b.onclick=function(){delAccount(b.getAttribute('data-del'));};
    });
  }

  function renderLastRun(lr){
    var el=$('#runState');
    if(!lr){el.className='tag';el.textContent='尚未运行';return;}
    var d=new Date(lr.ts);
    var okCount=(lr.results||[]).filter(function(r){return r.ok;}).length;
    el.className='tag '+((lr.results||[]).some(function(r){return !r.ok;})?'warn':'ok');
    el.textContent='上次 '+d.toLocaleString()+' 成功 '+okCount+'/'+(lr.accountCount||0);
  }

  async function loadLogs(){
    try{
      var r=await api('/api/logs'); var d=await r.json();
      var box=$('#logBox'); var arr=d.logs||[];
      box.innerHTML='';
      arr.forEach(function(e){
        var line=document.createElement('div');
        line.className='log-line log-'+(e.level||'info');
        var t=new Date(e.ts).toLocaleTimeString();
        line.textContent='['+t+'] '+e.msg;
        box.appendChild(line);
      });
      box.scrollTop=box.scrollHeight;
    }catch(e){/* 401 会跳转登录 */}
  }

  async function saveAcc(){
    var name=$('#f_name').value.trim();
    var user=$('#f_user').value.trim();
    var password=$('#f_password').value;
    var device=$('#f_device').value.trim();
    if(!user){$('#accMsg').textContent='账号必填';return;}
    var payload={name:name,user:user,password:password,deviceCode:device};
    var r, d;
    try{
      if(editingId){
        r=await api('/api/accounts/'+editingId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      }else{
        if(!password){$('#accMsg').textContent='新增账号密码必填';return;}
        r=await api('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      }
      d=await r.json();
    }catch(e){return;}
    if(!r.ok){$('#accMsg').textContent=d.error||'保存失败';return;}
    $('#accMsg').textContent='';
    resetForm();
    toast(editingId?'已更新':'已添加');
    await loadState();
  }

  function startEdit(id){
    api('/api/state').then(function(r){return r.json();}).then(function(d){
      var a=(d.accounts||[]).find(function(x){return x.id===id;});
      if(!a)return;
      editingId=id;
      $('#f_name').value=a.name||'';
      $('#f_user').value=a.user||'';
      $('#f_password').value='';
      $('#f_device').value=(a.deviceCode==='已设置'?'':'');
      $('#formTitle').textContent='编辑账号';
      $('#cancelEdit').hidden=false;
      $('#saveAcc').textContent='更新账号';
      window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});
    });
  }

  function resetForm(){
    editingId=null;
    $('#f_name').value='';$('#f_user').value='';
    $('#f_password').value='';$('#f_device').value='';
    $('#formTitle').textContent='添加账号';
    $('#cancelEdit').hidden=true;
    $('#saveAcc').textContent='保存账号';
  }

  async function delAccount(id){
    if(!confirm('确认删除该账号？'))return;
    var r=await api('/api/accounts/'+id,{method:'DELETE'});
    var d=await r.json();
    if(r.ok){toast('已删除');await loadState();}
    else{$('#accMsg').textContent=d.error||'删除失败';}
  }

  async function saveSettings(){
    var sec=parseInt($('#keepAliveSeconds').value,10);
    var r=await api('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keepAliveSeconds:sec})});
    var d=await r.json();
    if(r.ok)toast('设置已保存');
    else toast(d.error||'保存失败');
  }

  async function runNow(){
    $('#runState').className='tag warn';
    $('#runState').textContent='运行中…';
    var r=await api('/api/run',{method:'POST'});
    var d=await r.json();
    if(r.ok){toast('保活任务已启动，请查看日志');}
    else{toast(d.error||'启动失败');}
  }

  function showLogin(msg){
    $('#app').hidden=true;
    $('#login').style.display='flex';
    $('#loginErr').textContent=msg||'';
    $('#tokenInput').focus();
  }
  function hideLogin(){
    $('#login').style.display='none';
    $('#app').hidden=false;
  }

  async function boot(){
    if(!getToken()){showLogin('');return;}
    try{
      await loadState();
      hideLogin();
      loadLogs();
      if(logTimer)clearInterval(logTimer);
      logTimer=setInterval(loadLogs,2500);
    }catch(e){showLogin('');}
  }

  // 事件绑定
  $('#loginBtn').onclick=function(){
    var t=$('#tokenInput').value.trim();
    if(!t){$('#loginErr').textContent='请输入令牌';return;}
    setToken(t); boot();
  };
  $('#tokenInput').addEventListener('keydown',function(e){if(e.key==='Enter')$('#loginBtn').click();});
  $('#saveAcc').onclick=saveAcc;
  $('#cancelEdit').onclick=resetForm;
  $('#saveSettings').onclick=saveSettings;
  $('#runBtn').onclick=runNow;

  boot();
})();
</script>
</body>
</html>`;
