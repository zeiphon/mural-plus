#ifndef PlusRecoveryPage_h
#define PlusRecoveryPage_h
#include <pgmspace.h>

// Served at /recovery, and at / when the web UI is missing (ota.cpp). Installs
// an update file (scripts/package_release.py, format in OTA_PLAN.md section 2)
// or a web UI image (littlefs.bin) without needing the web UI itself.
static const char RECOVERY_PAGE[] PROGMEM = R"html(<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mural recovery</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;max-width:34em;margin:2em auto;padding:0 16px;background:#0b0f19;color:#ddd}
h1{font-size:1.4em}code{color:#9cf}button{font:inherit;padding:.4em 1.2em;margin-top:1em}
#msg{white-space:pre-wrap;color:#aaa;margin-top:1em}
</style></head><body>
<h1>Mural recovery</h1>
<p id="info">Loading…</p>
<p>Choose an update file (<code>…-update.bin</code>) to install the firmware and web UI, or a web UI image (<code>…-littlefs.bin</code>) to reinstall only the web UI.</p>
<input type="file" id="file"><br><button id="go">Install</button>
<p id="msg"></p>
<script>
var $=function(id){return document.getElementById(id)},say=function(t){$('msg').textContent=t},st=null;
fetch('/ota/status').then(function(r){return r.json()}).then(function(s){st=s;
 $('info').textContent='Firmware '+s.firmware+' (slot '+s.slot+'). Web UI: '+(s.uiMissing?'missing':(s.ui||'unknown version'))+'.';
 if(s.result&&s.result.reason)say('Last update: '+s.result.kind+'. '+s.result.reason);
}).catch(function(){$('info').textContent='Mural isn\'t responding.'});
function send(url,blob,label){return new Promise(function(ok,fail){
 var x=new XMLHttpRequest(),d=new FormData(),err=function(m,s){var e=new Error(m);e.status=s;fail(e)};d.append('file',blob,'image.bin');
 if(label)x.upload.onprogress=function(e){if(e.lengthComputable)say(label+': '+Math.round(e.loaded*100/e.total)+'%')};
 x.onload=function(){x.status<300?ok(x.responseText):err(x.responseText||('HTTP '+x.status),x.status)};
 x.onerror=function(){err('Network error',0)};x.open('POST',url);x.send(d)})}
function sendUi(blob,size,sha){var off=0,tries=0,P=32768;return new Promise(function(ok,fail){(function next(){
 if(off>=size)return ok();var end=Math.min(off+P,size);say('Web UI: '+Math.round(off*100/size)+'%');
 send('/ota/ui?offset='+off+'&total='+size+(sha?'&sha256='+sha:''),blob.slice(off,end),null).then(function(){off=end;tries=0;next()},
  function(e){if((e.status===0||e.status>=500)&&++tries<=3)return setTimeout(next,500*tries);fail(e)})})()})}
function waitForRestart(){say('Restarting and installing. This can take a minute…');
 setTimeout(function poll(){fetch('/ota/status').then(function(){location.href='/'}).catch(function(){setTimeout(poll,3000)})},8000)}
function text(buf){return new TextDecoder().decode(buf)}
$('go').onclick=function(){var f=$('file').files[0];if(!f||!st)return;$('go').disabled=true;
 f.slice(0,4096).arrayBuffer().then(function(head){
  if(text(new Uint8Array(head,0,8))==='MURALUPD'){
   var n=new DataView(head).getUint32(8,true);
   return f.slice(12,12+n).arrayBuffer().then(function(h){
    var hd=JSON.parse(text(h)),base=12+n,part=function(name){return hd.parts.filter(function(p){return p.name===name})[0]};
    if(hd.product!==st.product)throw new Error('This update is for '+hd.product+', not '+st.product+'.');
    var ui=part('ui'),fw=part('firmware'),piece=function(p){return f.slice(base+p.offset,base+p.offset+p.size)};
    return sendUi(piece(ui),ui.size,ui.sha256).then(function(){
     return send('/ota/firmware?size='+fw.size+'&sha256='+fw.sha256+'&uiSha256='+ui.sha256+'&version='+encodeURIComponent(hd.version),piece(fw),'Firmware')})})}
  if(f.size!==st.uiPartitionBytes)throw new Error('That isn\'t an update file or a web UI image for this board.');
  return sendUi(f,f.size,'').then(function(){return fetch('/ota/installUi',{method:'POST'})})
   .then(function(r){if(!r.ok)return r.text().then(function(t){throw new Error(t)})})
 }).then(waitForRestart).catch(function(e){say('Failed: '+e.message);$('go').disabled=false})};
</script></body></html>
)html";

#endif
