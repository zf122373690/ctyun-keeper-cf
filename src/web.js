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
  .runstat{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)}
  .runstat-item b{color:var(--text);font-weight:600}
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
  /* 云电脑状态卡片 */
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:4px}
  .pc-card{background:#0f172a;border:1px solid var(--border);border-radius:10px;padding:12px;position:relative;min-height:104px}
  .pc-card .pc-name{font-size:14px;font-weight:600;color:#e2e8f0;margin-right:64px;word-break:break-all}
  .pc-card .pc-code{color:var(--muted);font-size:12px;margin-top:3px}
  .pc-card .pc-acc{color:var(--muted);font-size:11px;margin-top:6px}
  .pc-card .pc-meta{margin-top:10px;font-size:12px;color:#cbd5e1;line-height:1.8}
  .pc-card .pc-meta b{color:var(--muted);font-weight:500;margin-right:4px}
  .pc-badge{position:absolute;top:12px;right:12px}
  .pc-empty{color:var(--muted)}
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
    <div class="sub">Cloudflare Workers · 网页管理后台 · 账号存于 KV，日志实时展示不落盘</div>

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
        <span id="kvStat" class="tag" style="margin-left:8px"></span>
        <span id="runState" class="tag" style="margin-left:auto"></span>
      </div>
      <div class="runstat">
        <span class="runstat-item">自动保活：<b id="cronInfo">—</b></span>
        <span class="runstat-item">上次运行：<b id="lastRunTime">—</b></span>
        <span class="runstat-item">触发：<b id="lastRunTrigger">—</b></span>
        <span class="runstat-item">下次运行约：<b id="nextRun">—</b></span>
        <span class="runstat-item">心跳：<b id="heartbeat">—</b></span>
      </div>
    </div>

    <div class="panel">
      <h2>云电脑状态 <span id="pcSummary" class="tag" style="margin-left:8px"></span></h2>
      <div id="pcBody"><div style="color:var(--muted)">暂无数据，运行一次后显示。</div></div>
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
      <h2>执行日志 <button id="clearLogs" class="ghost" style="float:right;padding:4px 10px;font-size:12px">清屏</button></h2>
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
  var tickStarted=false;
  var cronExpr='*/1 * * * *';
  var serverTime=Date.now();
  var lastRunTs=0;

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
    cronExpr=d.cronExpr||'*/1 * * * *';
    serverTime=d.serverTime||Date.now();
    renderAccounts(d.accounts||[]);
    renderLastRun(d.lastRun);
    renderPc(d.accounts||[]);
    renderPcSummary(d.pcSummary);
    var _mf=cronExpr.trim().split(' ').filter(Boolean)[0]||'*';
    var _step=_mf.indexOf('/')>=0?parseInt(_mf.split('/')[1],10)||1:1;
    $('#cronInfo').textContent='每 '+_step+' 分钟（'+cronExpr+'）';
  }

  function renderPcSummary(s){
    var el=$('#pcSummary');
    if(!s||s.total===0){el.className='tag';el.textContent='共 0 台';return;}
    el.className='tag '+(s.online===s.total?'ok':'warn');
    el.textContent='共 '+s.total+' 台 · 在线 '+s.online+' 台';
  }

  function renderPc(accounts){
    var wrap=$('#pcBody');
    var cards=[];
    (accounts||[]).forEach(function(a){
      var st=a.status;
      if(!st)return;
      var ds=st.desktops||[];
      if(ds.length===0){
        if(st.error){
          cards.push(cardHtml(a.name||a.user,'—','—',st.error,false,false,null,null,true));
        }
        return;
      }
      ds.forEach(function(d){
        cards.push(cardHtml(a.name||a.user,d.name,d.desktopCode,d.status,!!d.online,!!d.keptAlive,d.onlineSince||null,d.keepAliveStart||null,false));
      });
    });
    if(!cards.length){
      wrap.innerHTML='<div class="pc-empty">暂无云电脑状态数据，运行一次后显示。</div>';
      return;
    }
    wrap.innerHTML='<div class="cards">'+cards.join('')+'</div>';
    tickDurations();
  }

  function cardHtml(account,name,code,status,online,kept,onlineSince,keepAliveStart,isErr){
    var badge = online
      ? '<span class="tag ok pc-badge">在线 · '+(esc(status)||'运行中')+'</span>'
      : '<span class="tag '+(isErr?'err':'warn')+' pc-badge">'+esc(status||'离线')+'</span>';
    var dur = (online && onlineSince)
      ? '<span class="pc-dur" data-since="'+onlineSince+'">计算中…</span>'
      : (isErr ? '—' : '未运行');
    var keepLine = isErr ? '' :
      '<div><b>本次</b>'+(kept
        ? '<span class="tag ok" style="padding:1px 6px">保活中</span>'
        : '<span class="tag warn" style="padding:1px 6px">未接管</span>')+'</div>';
    return '<div class="pc-card">'+badge+
      '<div class="pc-name">'+esc(name)+'</div>'+
      '<div class="pc-code">编号：'+esc(code)+'</div>'+
      '<div class="pc-acc">账号：'+esc(account)+'</div>'+
      '<div class="pc-meta">'+
        '<div><b>保活始于</b>'+(keepAliveStart?fmtTime(keepAliveStart):'—')+'</div>'+
        '<div><b>已在线</b>'+dur+'</div>'+
        keepLine+
      '</div>'+
    '</div>';
  }

  function fmtTime(ts){
    if(!ts)return '—';
    var d=new Date(ts);
    function p(n){return (n<10?'0':'')+n;}
    return (d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
  }

  function fmtDuration(ms){
    if(!(ms>0))return '0秒';
    var s=Math.floor(ms/1000);
    var d=Math.floor(s/86400); s-=d*86400;
    var h=Math.floor(s/3600); s-=h*3600;
    var m=Math.floor(s/60); s-=m*60;
    if(d>0)return d+'天'+h+'小时'+m+'分';
    if(h>0)return h+'小时'+m+'分';
    if(m>0)return m+'分'+s+'秒';
    return s+'秒';
  }

  function tickDurations(){
    var els=document.querySelectorAll('.pc-dur');
    var now=Date.now();
    els.forEach(function(el){
      var since=parseInt(el.getAttribute('data-since'),10);
      if(since)el.textContent=fmtDuration(now-since);
    });
  }

  // 下次 Cron 运行倒计时（仅对「每 N 分钟」这类简单表达式估算）
  function tickNextRun(){
    var el=document.getElementById('nextRun');
    if(!el)return;
    if(!cronExpr)return;
    var now=Date.now();
    var fields=cronExpr.trim().split(' ').filter(Boolean);
    var minuteField=fields[0]||'*';
    var step=1;
    if(minuteField.indexOf('/')>=0)step=parseInt(minuteField.split('/')[1],10)||1;
    if(fields.length>=5 && minuteField.indexOf('/')>=0){
      // 以服务端时间为基准推算下一个整分步长（serverTime 校准过偏移）
      var offset=now-serverTime;
      var base=new Date(serverTime+offset);
      var past=base.getMinutes()%step;
      var next=new Date(base.getTime()+(step-past)*60000);
      el.textContent=fmtTime(next.getTime());
    }else{
      el.textContent='('+cronExpr+')';
    }
    // 心跳随时间漂移，需周期性刷新文字
    var hb=document.getElementById('heartbeat');
    if(hb && lastRunTs){
      var gapMin=Math.floor((now-lastRunTs)/60000);
      if(gapMin<=2){hb.textContent='正常（'+gapMin+'分钟前）';hb.style.color='var(--ok)';}
      else if(gapMin<=10){hb.textContent='偏久（'+gapMin+'分钟前）';hb.style.color='var(--warn)';}
      else{hb.textContent='异常·可能停摆（'+gapMin+'分钟前）';hb.style.color='var(--danger)';}
    }
  }

  async function loadKvStats(){
    try{
      var r=await api('/api/kv/stats'); var d=await r.json();
      var list=d.stats||[];
      var total=list.reduce(function(s,k){return s+(k.bytes>0?k.bytes:0);},0);
      $('#kvStat').textContent='KV 占用 '+(total/1024).toFixed(1)+' KB · '+list.length+' 键';
    }catch(e){}
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
    if(!lr){
      el.className='tag';el.textContent='尚未运行';
      $('#lastRunTime').textContent='—';
      $('#lastRunTrigger').textContent='—';
      $('#heartbeat').textContent='未见运行';
      $('#heartbeat').style.color='var(--muted)';
      return;
    }
    var d=new Date(lr.ts);
    var okCount=(lr.results||[]).filter(function(r){return r.ok;}).length;
    el.className='tag '+((lr.results||[]).some(function(r){return !r.ok;})?'warn':'ok');
    el.textContent='上次 '+fmtTime(lr.ts)+' 成功 '+okCount+'/'+(lr.accountCount||0);
    lastRunTs=lr.ts||0;
    $('#lastRunTime').textContent=fmtTime(lr.ts);
    $('#lastRunTrigger').textContent=(lr.trigger==='cron'?'定时(Cron)':'手动');
    // 心跳：距上次运行超过 2 分钟视为异常（说明 Cron 可能未触发）
    var gapMin=Math.floor((Date.now()-lr.ts)/60000);
    var hb=$('#heartbeat');
    if(gapMin<=2){hb.textContent='正常（'+gapMin+'分钟前）';hb.style.color='var(--ok)';}
    else if(gapMin<=10){hb.textContent='偏久（'+gapMin+'分钟前）';hb.style.color='var(--warn)';}
    else{hb.textContent='异常·可能停摆（'+gapMin+'分钟前）';hb.style.color='var(--danger)';}
  }

  function appendLogLine(text){
    var box=$('#logBox');
    var line=document.createElement('div');
    line.className='log-line log-info';
    line.textContent=text;
    box.appendChild(line);
    box.scrollTop=box.scrollHeight;
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
    $('#logBox').innerHTML='';
    try{
      var r=await api('/api/run',{method:'POST'});
      if(!r.ok){
        var d=await r.json().catch(function(){return {};});
        toast(d.error||'启动失败');
        $('#runState').className='tag err';
        $('#runState').textContent='启动失败';
        return;
      }
      // 流式读取响应，逐行实时展示（日志不写入 KV）
      var reader=r.body.getReader();
      var dec=new TextDecoder();
      var buf='';
      while(true){
        var chunk=await reader.read();
        if(chunk.done)break;
        buf+=dec.decode(chunk.value,{stream:true});
        // 按行切分日志流；用 char(10) 避免模板字符串把换行转义吞掉
        var parts=buf.split(String.fromCharCode(10));
        buf=parts.pop();
        for(var i=0;i<parts.length;i++){
          if(parts[i].length)appendLogLine(parts[i]);
        }
      }
      if(buf.length)appendLogLine(buf);
      try{await loadState();}catch(_){}
      $('#runState').className='tag ok';
      $('#runState').textContent='运行完成';
    }catch(e){
      if(e.message==='unauthorized')return;
      // 流中断也视为结束
      try{await loadState();}catch(_){}
      $('#runState').className='tag ok';
      $('#runState').textContent='运行结束';
    }
  }

  function clearLogs(){
    $('#logBox').innerHTML='';
    toast('已清屏');
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
      loadKvStats();
      // 云电脑状态每 30 秒自动刷新（仅 GET /api/state，KV 只读不写，免费）
      setInterval(function(){loadState().catch(function(){});},30000);
      // 「已在线」时长每秒刷新一次（仅前端计算，不请求后端）
      if(!tickStarted){tickStarted=true;setInterval(function(){tickDurations();tickNextRun();},1000);}
      tickNextRun();
      // 日志仅在手动「立即运行」时通过流式实时展示，无需轮询 KV
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
  $('#clearLogs').onclick=clearLogs;

  boot();
})();
</script>
</body>
</html>`;
