// ===== BRAJWASI TRAVELS – MAIN JS =====

let currentCar = {};
let chatSessionId = localStorage.getItem('bt_chat_session') || null;
let chatCustomerName = localStorage.getItem('bt_chat_name') || null;
let socket = null;

// ---- Header scroll ----
const header = document.getElementById('header');
window.addEventListener('scroll', () => {
  header.classList.toggle('scrolled', window.scrollY > 60);
});

// ---- Hero bg animation ----
window.addEventListener('load', () => {
  document.querySelector('.hero-bg')?.classList.add('loaded');
  initAnimations();
});

// ---- Mobile menu ----
document.getElementById('hamburger')?.addEventListener('click', () => {
  document.getElementById('mobile-menu').classList.toggle('open');
});
function closeMobileMenu() { document.getElementById('mobile-menu')?.classList.remove('open'); }

// ---- Push Notifications ----
async function initPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
    if (Notification.permission === 'default') {
      setTimeout(() => {
        const bar = document.getElementById('notif-bar');
        if (bar) bar.style.display = 'flex';
      }, 4000);
    }
  } catch(e) {}
}

async function requestNotificationPermission() {
  document.getElementById('notif-bar').style.display = 'none';
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    await subscribePush();
    showToast('✅ Notifications enabled!', 'success');
  }
}

async function subscribePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await fetch('/vapid-public-key').then(r => r.json());
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(publicKey) });
    await fetch('/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
  } catch(e) {}
}

function urlB64ToUint8(b64) {
  const padding = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ---- Socket.IO ----
function initSocket() {
  socket = io();
  socket.on('new-message', (msg) => {
    appendChatMessage(msg.sender, msg.text, msg.timestamp);
  });
}

// ---- BOOKING MODAL ----
function openBookingModal(carId, carModel, carName, pricePerKm, fixedKm, fixedPrice, extraKmCharge) {
  currentCar = { carId, carModel, carName, pricePerKm, fixedKm, fixedPrice, extraKmCharge };

  document.getElementById('bk-car-id').value = carId;
  document.getElementById('modal-car-name').textContent = carName + ' ' + carModel;
  document.getElementById('est-km').value = '';
  document.getElementById('calc-price').textContent = '';
  document.getElementById('calc-note').textContent = '';

  const today = new Date().toISOString().split('T')[0];
  document.getElementById('bk-date').min = today;
  document.getElementById('bk-date').value = '';
  document.getElementById('bk-time').value = '';
  document.getElementById('bk-name').value = '';
  document.getElementById('bk-phone').value = '';
  document.getElementById('bk-email').value = '';
  document.getElementById('bk-pickup').value = '';
  document.getElementById('bk-drop').value = '';
  document.getElementById('bk-notes').value = '';

  document.getElementById('bookingModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeBookingModal() {
  document.getElementById('bookingModal').classList.remove('open');
  document.body.style.overflow = '';
}

function closeSuccessModal() {
  document.getElementById('successModal').classList.remove('open');
  document.body.style.overflow = '';
}

// Close on overlay click
document.getElementById('bookingModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeBookingModal(); });
document.getElementById('successModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeSuccessModal(); });

// ---- Price Calculator ----
function calcPrice() {
  const km = parseInt(document.getElementById('est-km').value) || 0;
  const { pricePerKm, fixedKm, fixedPrice, extraKmCharge } = currentCar;

  if (km <= 0) {
    document.getElementById('calc-price').textContent = '';
    document.getElementById('calc-note').textContent = '';
    return;
  }

  let total = 0, note = '';

  if (fixedKm && fixedPrice && km <= fixedKm) {
    total = fixedPrice;
    note = `Fixed ${fixedKm}km package applies. Toll extra.`;
  } else if (fixedKm && fixedPrice && km > fixedKm) {
    const extra = km - fixedKm;
    total = parseInt(fixedPrice) + (extra * extraKmCharge);
    note = `Fixed ${fixedKm}km (₹${fixedPrice}) + ${extra}km extra × ₹${extraKmCharge} = ₹${extra * extraKmCharge}. Toll extra.`;
  } else {
    total = km * pricePerKm;
    note = `${km}km × ₹${pricePerKm}/km. Toll extra.`;
  }

  document.getElementById('calc-price').textContent = '≈ ₹' + total.toLocaleString('en-IN');
  document.getElementById('calc-note').textContent = note;
}

// ---- Submit Booking ----
async function submitBooking(e) {
  e.preventDefault();
  const btn = document.getElementById('book-submit-btn');

  const payload = {
    carId: document.getElementById('bk-car-id').value,
    customerName: document.getElementById('bk-name').value.trim(),
    customerPhone: document.getElementById('bk-phone').value.trim(),
    customerEmail: document.getElementById('bk-email').value.trim(),
    pickupLocation: document.getElementById('bk-pickup').value.trim(),
    dropLocation: document.getElementById('bk-drop').value.trim(),
    journeyDate: document.getElementById('bk-date').value,
    journeyTime: document.getElementById('bk-time').value,
    estimatedKm: document.getElementById('est-km').value || 0,
    notes: document.getElementById('bk-notes').value.trim()
  };

  if (!payload.customerName || !payload.customerPhone || !payload.pickupLocation || !payload.dropLocation || !payload.journeyDate || !payload.journeyTime) {
    showToast('Please fill all required fields', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

  try {
    const res = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      closeBookingModal();
      document.getElementById('s-booking-id').textContent = data.bookingId;
      const waText = encodeURIComponent(
        `Hello Brajwasi Travels,\n\nBooking Confirmed!\n📋 Booking ID: ${data.bookingId}\n🚗 Car: ${currentCar.carName} ${currentCar.carModel}\n📍 From: ${payload.pickupLocation}\n🏁 To: ${payload.dropLocation}\n📅 Date: ${payload.journeyDate} at ${payload.journeyTime}\n💰 Est. Fare: ₹${data.totalPrice || 'TBD'}\n\nAdvance ₹500 UPI: MRBRAJWASITRAVELS.eazypay@icici`
      );
      document.getElementById('wa-share-btn').href = `https://wa.me/919411061000?text=${waText}`;
      document.getElementById('successModal').classList.add('open');
      document.body.style.overflow = 'hidden';
    } else {
      showToast(data.error || 'Booking failed. Please call 9411061000', 'error');
    }
  } catch(err) {
    showToast('Network error. Please call 9411061000', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check-circle"></i> Confirm Booking';
  }
}

// ---- UPI Copy ----
function copyUPI() {
  navigator.clipboard?.writeText('MRBRAJWASITRAVELS.eazypay@icici').then(() => showToast('UPI ID copied!', 'success'));
}

// ---- Quick Enquiry ----
document.getElementById('enquiryForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('eq-name').value;
  const phone = document.getElementById('eq-phone').value;
  const route = document.getElementById('eq-route').value;
  const date = document.getElementById('eq-date').value;
  const msg = encodeURIComponent(`Hello Brajwasi Travels,\n\nEnquiry from Website:\n👤 ${name}\n📞 ${phone}\n🗺 Route: ${route}\n📅 Date: ${date}\n\nPlease confirm availability.`);
  window.open(`https://wa.me/919411061000?text=${msg}`, '_blank');
  e.target.reset();
});

// ---- CHAT WIDGET ----
function toggleChat() {
  const widget = document.getElementById('chat-widget');
  const isOpen = widget.style.display !== 'none';
  widget.style.display = isOpen ? 'none' : 'flex';
  widget.style.flexDirection = 'column';
  if (!isOpen && chatSessionId) showChatMessages();
  document.getElementById('chat-badge').style.display = 'none';
}

function startChat() {
  const name = document.getElementById('cw-name').value.trim();
  const phone = document.getElementById('cw-phone').value.trim();
  if (!name) { document.getElementById('cw-name').focus(); return; }

  chatCustomerName = name;
  if (!chatSessionId) {
    chatSessionId = 'chat-' + Date.now() + '-' + Math.random().toString(36).substr(2,6);
    localStorage.setItem('bt_chat_session', chatSessionId);
    localStorage.setItem('bt_chat_name', name);
  }

  if (!socket) {
    socket = io({ query: { sessionId: chatSessionId } });
    socket.on('new-message', (msg) => appendChatMessage(msg.sender, msg.text, msg.timestamp));
  }

  document.getElementById('cw-name-form').style.display = 'none';
  document.getElementById('cw-messages').style.display = 'flex';
  document.getElementById('cw-input-area').style.display = 'flex';

  appendChatMessage('admin', `Hello ${name}! 👋 Welcome to Brajwasi Travels. How can we help you today?`, new Date());

  if (phone) {
    socket.emit('customer-message', { sessionId: chatSessionId, text: `[User Info] Name: ${name}, Phone: ${phone}`, customerName: name, customerPhone: phone });
  }
}

function showChatMessages() {
  document.getElementById('cw-name-form').style.display = 'none';
  document.getElementById('cw-messages').style.display = 'flex';
  document.getElementById('cw-input-area').style.display = 'flex';
  if (!socket) {
    socket = io({ query: { sessionId: chatSessionId } });
    socket.on('new-message', (msg) => appendChatMessage(msg.sender, msg.text, msg.timestamp));
  }
}

function sendChatMessage() {
  const input = document.getElementById('cw-msg-input');
  const text = input.value.trim();
  if (!text || !socket) return;
  socket.emit('customer-message', {
    sessionId: chatSessionId,
    text,
    customerName: chatCustomerName || 'Guest',
    customerPhone: ''
  });
  appendChatMessage('customer', text, new Date());
  input.value = '';
}

function appendChatMessage(sender, text, timestamp) {
  const container = document.getElementById('cw-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = `cw-msg ${sender}`;
  const t = new Date(timestamp);
  div.innerHTML = `${text}<span class="cw-msg-time">${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}</span>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ---- Toast ----
function showToast(msg, type = 'success') {
  document.querySelector('.bt-toast')?.remove();
  const t = document.createElement('div');
  t.className = 'bt-toast';
  t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:99999;
    background:${type==='success'?'#1a3a2a':'#3a1a1a'};
    border:1px solid ${type==='success'?'#3fb950':'#f85149'};
    color:${type==='success'?'#3fb950':'#f85149'};
    padding:12px 20px;border-radius:10px;font-size:14px;font-weight:500;
    box-shadow:0 4px 20px rgba(0,0,0,0.2);white-space:nowrap;
    animation:fadeUp 0.3s ease;font-family:'DM Sans',sans-serif;`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ---- Scroll animations ----
function initAnimations() {
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.style.opacity='1'; e.target.style.transform='translateY(0)'; }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.car-card, .why-card').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    obs.observe(el);
  });
}

// ---- Init ----
initPushNotifications();
if (chatSessionId) {
  document.getElementById('chat-badge').style.display = 'flex';
}
