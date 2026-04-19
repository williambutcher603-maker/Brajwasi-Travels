// ===== BRAJWASI TRAVELS =====
let curCar = {}, curBid = '', chatSock = null;
const LS = { sid: localStorage.getItem('bt_sid'), name: localStorage.getItem('bt_name'), phone: localStorage.getItem('bt_phone') };
let chatReady = false;

// Header scroll
window.addEventListener('scroll', () => document.getElementById('hdr').classList.toggle('on', scrollY > 50));
window.addEventListener('load', () => { document.querySelector('.hero-bg')?.classList.add('rdy'); initAnim(); initPush(); if(LS.sid) document.getElementById('chat-dot').style.display='flex'; });

// Mobile menu
document.getElementById('burger')?.addEventListener('click', () => document.getElementById('mob-nav').classList.toggle('open'));
function closeMob(){ document.getElementById('mob-nav')?.classList.remove('open'); }

// ===== PUSH =====
async function initPush(){
  if(!('serviceWorker' in navigator)||!('PushManager' in window)) return;
  try{
    await navigator.serviceWorker.register('/sw.js');
    if(Notification.permission==='default') setTimeout(()=>{ const b=document.getElementById('notif-bar'); if(b) b.style.display='flex'; },5000);
  }catch(e){}
}
async function askNotifPermission(){
  document.getElementById('notif-bar').style.display='none';
  const p=await Notification.requestPermission();
  if(p==='granted'){ await subPush(); toast('✅ Notifications enabled!','ok'); }
}
async function subPush(){
  try{
    const reg=await navigator.serviceWorker.ready;
    const {publicKey}=await fetch('/vapid-public-key').then(r=>r.json());
    if(!publicKey) return;
    const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(publicKey)});
    await fetch('/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sub)});
  }catch(e){}
}
function b64(s){ const pad='='.repeat((4-s.length%4)%4); const b=(s+pad).replace(/-/g,'+').replace(/_/g,'/'); const r=atob(b); return Uint8Array.from([...r].map(c=>c.charCodeAt(0))); }

// ===== SOCKET CHAT =====
function initSock(){
  if(chatSock) return;
  chatSock = io({ query:{ sessionId: LS.sid } });
  chatSock.on('msg', m => { addChatMsg(m.sender, m.text, m.ts); const w=document.getElementById('chat-w'); if(w.style.display==='none'||!w.style.display){ document.getElementById('chat-dot').style.display='flex'; } });
}

// ===== CHAT WIDGET =====
function toggleChat(){
  const w=document.getElementById('chat-w');
  const vis=w.style.display==='flex';
  if(vis){ w.style.display='none'; }
  else{
    w.style.display='flex';
    w.style.flexDirection='column';
    document.getElementById('chat-dot').style.display='none';
    if(LS.sid && !chatReady){ loadChatHistory(); }
  }
}
async function loadChatHistory(){
  try{
    const d=await fetch('/api/chat/'+LS.sid).then(r=>r.json());
    if(d.messages && d.messages.length){
      showChatUI();
      d.messages.filter(m=>!m.text.startsWith('[Info]')).forEach(m=>addChatMsg(m.sender,m.text,m.timestamp));
      chatReady=true;
      initSock();
    }
  }catch(e){}
}
function showChatUI(){
  document.getElementById('cw-start').style.display='none';
  document.getElementById('cw-msgs').style.display='flex';
  document.getElementById('cw-inp').style.display='flex';
}
function startChat(){
  const name=document.getElementById('cw-name').value.trim();
  if(!name){ document.getElementById('cw-name').focus(); return; }
  const phone=document.getElementById('cw-phone').value.trim();
  LS.sid = LS.sid || ('c-'+Date.now()+'-'+Math.random().toString(36).substr(2,5));
  LS.name=name; LS.phone=phone;
  localStorage.setItem('bt_sid',LS.sid); localStorage.setItem('bt_name',name); if(phone) localStorage.setItem('bt_phone',phone);
  chatReady=true;
  initSock();
  showChatUI();
  addChatMsg('admin',`Hello ${name}! 👋 How can we help you today?`,new Date());
  chatSock.emit('cust-msg',{sessionId:LS.sid,text:`[Info] Name:${name}${phone?', Phone:'+phone:''}`,name,phone});
}
function sendMsg(){
  const inp=document.getElementById('cw-txt');
  const t=inp?.value.trim();
  if(!t||!chatSock||!LS.sid) return;
  chatSock.emit('cust-msg',{sessionId:LS.sid,text:t,name:LS.name||'Guest',phone:LS.phone||''});
  addChatMsg('customer',t,new Date());
  inp.value='';
}
function addChatMsg(sender,text,ts){
  const c=document.getElementById('cw-msgs');
  if(!c) return;
  const d=document.createElement('div');
  d.className='cwm '+sender;
  const t=new Date(ts);
  d.innerHTML=esc(text)+'<span class="cwm-t">'+t.getHours()+':'+String(t.getMinutes()).padStart(2,'0')+'</span>';
  c.appendChild(d);
  c.scrollTop=c.scrollHeight;
}

// ===== BOOKING =====
function openBook(id,model,name,ppk,fkm,fp,ekm){
  curCar={id,model,name,ppk:+ppk,fkm:+fkm,fp:+fp,ekm:+ekm};
  document.getElementById('bk-id').value=id;
  document.getElementById('m-car').textContent=name+' '+model;
  document.getElementById('est-km').value='';
  document.getElementById('calc-out').textContent='';
  document.getElementById('calc-note').textContent='';
  document.getElementById('bk-date').min=new Date().toISOString().split('T')[0];
  ['bk-name','bk-phone','bk-email','bk-pickup','bk-drop','bk-date','bk-time','bk-notes'].forEach(i=>{ const el=document.getElementById(i); if(el) el.value=''; });
  show('bookModal');
}
function closeBook(){ hide('bookModal'); }
function closePayM(){ hide('payModal'); show('doneModal'); }
function payLater(){ hide('payModal'); show('doneModal'); }
function closeDone(){ hide('doneModal'); }

function calcFare(){
  const km=parseInt(document.getElementById('est-km').value)||0;
  if(!km){ document.getElementById('calc-out').textContent=''; document.getElementById('calc-note').textContent=''; return; }
  let total=0,note='';
  if(curCar.fkm&&curCar.fp&&km<=curCar.fkm){ total=curCar.fp; note=`Fixed ${curCar.fkm}km package. Toll extra.`; }
  else if(curCar.fkm&&curCar.fp){ const ex=km-curCar.fkm; total=curCar.fp+(ex*curCar.ekm); note=`Package ₹${curCar.fp} + ${ex}km×₹${curCar.ekm}. Toll extra.`; }
  else{ total=km*curCar.ppk; note=`${km}km×₹${curCar.ppk}/km. Toll extra.`; }
  document.getElementById('calc-out').textContent='≈₹'+total.toLocaleString('en-IN');
  document.getElementById('calc-note').textContent=note;
}

async function submitBook(e){
  e.preventDefault();
  const btn=document.getElementById('bk-btn');
  const payload={
    carId:document.getElementById('bk-id').value,
    customerName:document.getElementById('bk-name').value.trim(),
    customerPhone:document.getElementById('bk-phone').value.trim(),
    customerEmail:document.getElementById('bk-email').value.trim(),
    pickupLocation:document.getElementById('bk-pickup').value.trim(),
    dropLocation:document.getElementById('bk-drop').value.trim(),
    journeyDate:document.getElementById('bk-date').value,
    journeyTime:document.getElementById('bk-time').value,
    estimatedKm:document.getElementById('est-km').value||0,
    notes:document.getElementById('bk-notes').value.trim()
  };
  if(!payload.customerName||!payload.customerPhone||!payload.pickupLocation||!payload.dropLocation||!payload.journeyDate||!payload.journeyTime){ toast('Please fill all required fields','err'); return; }
  btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner" style="animation:spin 1s linear infinite"></i> Processing...';
  try{
    const d=await fetch('/api/book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(r=>r.json());
    if(d.success){
      curBid=d.bookingId;
      closeBook();
      // Set pay modal
      document.getElementById('pay-bid').textContent=d.bookingId;
      const upi=`upi://pay?pa=MRBRAJWASITRAVELS.eazypay@icici&pn=BrajwasiTravels&am=500&cu=INR&tn=Advance+${d.bookingId}`;
      const isMob=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if(!isMob){ const qr=document.getElementById('pay-qr'); qr.style.display='block'; document.getElementById('qr-img').src='https://api.qrserver.com/v1/create-qr-code/?size=150x150&data='+encodeURIComponent(upi); document.getElementById('pay-apps').style.display='none'; }
      // Done modal
      document.getElementById('done-bid').textContent=d.bookingId;
      document.getElementById('done-phone').textContent=payload.customerPhone;
      const wa=encodeURIComponent(`Hi Brajwasi Travels!\nBooking: ${d.bookingId}\n🚗 ${curCar.name} ${curCar.model}\n📍 ${payload.pickupLocation} → ${payload.dropLocation}\n📅 ${payload.journeyDate} ${payload.journeyTime}\n💰 Est: ₹${d.totalPrice||'TBD'}`);
      document.getElementById('wa-link').href=`https://wa.me/919411061000?text=${wa}`;
      show('payModal');
    } else { toast(d.error||'Booking failed. Call 9411061000','err'); }
  }catch(err){ toast('Network error. Call 9411061000','err'); }
  finally{ btn.disabled=false; btn.innerHTML='<i class="fas fa-check-circle"></i> Confirm Booking'; }
}

function payApp(app){
  const upiId='MRBRAJWASITRAVELS.eazypay@icici';
  const note='Advance+'+curBid;
  const urls={phonepe:`phonepe://pay?pa=${upiId}&pn=BrajwasiTravels&am=500&cu=INR&tn=${note}`,gpay:`tez://upi/pay?pa=${upiId}&pn=BrajwasiTravels&am=500&cu=INR&tn=${note}`,paytm:`paytmmp://pay?pa=${upiId}&pn=BrajwasiTravels&am=500&cu=INR&tn=${note}`,bhim:`upi://pay?pa=${upiId}&pn=BrajwasiTravels&am=500&cu=INR&tn=${note}`};
  window.location.href=urls[app]||urls.bhim;
  setTimeout(()=>{ hide('payModal'); show('doneModal'); },2500);
}

// Enquiry
document.getElementById('eqForm')?.addEventListener('submit',e=>{
  e.preventDefault();
  const msg=encodeURIComponent(`Hello Brajwasi Travels!\n\nEnquiry:\n👤 ${document.getElementById('eq-name').value}\n📞 ${document.getElementById('eq-phone').value}\n🗺 Route: ${document.getElementById('eq-route').value}\n📅 ${document.getElementById('eq-date').value}`);
  window.open(`https://wa.me/919411061000?text=${msg}`,'_blank');
  e.target.reset();
});

// Overlay close on bg click
['bookModal','payModal','doneModal'].forEach(id=>{
  document.getElementById(id)?.addEventListener('click',e=>{ if(e.target===e.currentTarget){ if(id==='bookModal') closeBook(); else if(id==='payModal') closePayM(); else closeDone(); } });
});

function show(id){ const el=document.getElementById(id); if(el){ el.classList.add('on'); document.body.style.overflow='hidden'; } }
function hide(id){ const el=document.getElementById(id); if(el){ el.classList.remove('on'); document.body.style.overflow=''; } }
function esc(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function toast(msg,type='ok'){
  document.querySelector('.bt-toast')?.remove();
  const t=document.createElement('div'); t.className='bt-toast';
  t.textContent=msg;
  t.style.cssText=`position:fixed;bottom:85px;left:50%;transform:translateX(-50%);z-index:99999;background:${type==='ok'?'#1a3a2a':'#3a1a1a'};border:1px solid ${type==='ok'?'#3fb950':'#f85149'};color:${type==='ok'?'#3fb950':'#f85149'};padding:11px 18px;border-radius:9px;font-size:14px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,0.12);white-space:nowrap;font-family:'DM Sans',sans-serif;`;
  document.body.appendChild(t); setTimeout(()=>t.remove(),3500);
}
function initAnim(){
  const obs=new IntersectionObserver(es=>es.forEach(e=>{ if(e.isIntersecting){e.target.style.opacity='1';e.target.style.transform='translateY(0)';} }),{threshold:0.08});
  document.querySelectorAll('.car-card,.why-c').forEach((el,i)=>{ el.style.opacity='0';el.style.transform='translateY(22px)';el.style.transition=`opacity 0.5s ease ${i*0.07}s,transform 0.5s ease ${i*0.07}s`;obs.observe(el); });
}
