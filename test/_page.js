
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
    renderPc(d.accounts||[]);
    renderPcSummary(d.pcSummary);
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
    if(!lr){el.className='tag';el.textContent='尚未运行';return;}
    var d=new Date(lr.ts);
    var okCount=(lr.results||[]).filter(function(r){return r.ok;}).length;
    el.className='tag '+((lr.results||[]).some(function(r){return !r.ok;})?'warn':'ok');
    el.textContent='上次 '+d.toLocaleString()+' 成功 '+okCount+'/'+(lr.accountCount||0);
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
        // 注意：此处必须写 '\n'（外层是模板字符串，单个 
 会被转成真实换行符，导致页面脚本语法错误）
        var parts=buf.split('\n');
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
      if(!tickStarted){tickStarted=true;setInterval(tickDurations,1000);}
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
