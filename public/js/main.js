// ============ BRAJWASI TRAVELS – MAIN JS ============

// Pricing state
let currentCarData = {};

// ---- Header scroll effect ----
const header = document.getElementById('header');
const notifBar = document.getElementById('notif-bar');
let notifBarHeight = 0;

window.addEventListener('scroll', () => {
  if (window.scrollY > 50) header.classList.add('scrolled');
  else header.classList.remove('scrolled');
});

// ---- Mobile menu ----
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');
hamburger?.addEventListener('click', () => mobileMenu.classList.toggle('open'));
mobileMenu?.querySelectorAll('a').forEach(a => a.addEventListener('click', () => mobileMenu.classList.remove('open')));

// ---- Hero bg animation ----
window.addEventListener('load', () => {
  document.querySelector('.hero-bg')?.classList.add('loaded');
});

// ---- Push Notifications ----
async function initPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  
  try {
    await navigator.serviceWorker.register('/sw.js');
    const permission = Notification.permission;
    if (permission === 'default') {
      setTimeout(() => {
        if (notifBar) notifBar.style.display = 'flex';
      }, 3000);
    }
  } catch(e) { console.log('SW registration failed:', e); }
}

async function requestNotificationPermission() {
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    notifBar.style.display = 'none';
    await subscribeToPush();
    showToast('✅ Notifications enabled! You\'ll get booking updates.', 'success');
  } else {
    notifBar.style.display = 'none';
  }
}

async function subscribeToPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const resp = await fetch('/vapid-public-key');
    const { publicKey } = await resp.json();
    
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    await fetch('/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub)
    });
  } catch(e) { console.log('Push subscription failed:', e); }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// ---- Booking Modal ----
function openBooking(carId, carModel, pricePerKm, fixedKm, fixedPrice, extraKmCharge) {
  currentCarData = { carId, carModel, pricePerKm, fixedKm, fixedPrice, extraKmCharge };
  
  document.getElementById('book-car-id').value = carId;
  document.getElementById('modal-car-name').textContent = carModel;
  document.getElementById('est-km').value = '';
  document.getElementById('calc-result').style.display = 'none';
  
  // Set min date to today
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('book-date').min = today;
  
  document.getElementById('bookingModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeBooking() {
  document.getElementById('bookingModal').classList.remove('open');
  document.body.style.overflow = '';
}

function closeSuccess() {
  document.getElementById('successModal').classList.remove('open');
  document.body.style.overflow = '';
}

// Close modal on overlay click
document.getElementById('bookingModal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeBooking();
});
document.getElementById('successModal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeSuccess();
});

// ---- Price Calculator ----
function calculatePrice() {
  const km = parseInt(document.getElementById('est-km').value);
  if (!km || km <= 0) {
    document.getElementById('calc-result').style.display = 'none';
    return;
  }

  const { pricePerKm, fixedKm, fixedPrice, extraKmCharge } = currentCarData;
  let total = 0;
  let breakdown = '';

  if (fixedKm && fixedPrice && km <= fixedKm) {
    total = fixedPrice;
    breakdown = `📦 Fixed ${fixedKm}km Package: ₹${fixedPrice}`;
  } else if (fixedKm && fixedPrice && km > fixedKm) {
    const extraKm = km - fixedKm;
    total = parseInt(fixedPrice) + (extraKm * extraKmCharge);
    breakdown = `📦 Fixed ${fixedKm}km: ₹${fixedPrice} + Extra ${extraKm}km × ₹${extraKmCharge} = ₹${extraKm * extraKmCharge}`;
  } else {
    total = km * pricePerKm;
    breakdown = `📍 ${km}km × ₹${pricePerKm}/km`;
  }

  const resultEl = document.getElementById('calc-result');
  resultEl.querySelector('.calc-breakdown').textContent = breakdown;
  resultEl.querySelector('.calc-total').textContent = `Estimated Fare: ₹${total.toLocaleString('en-IN')} (excl. toll)`;
  resultEl.style.display = 'block';
}

// ---- Booking Form Submission ----
document.getElementById('bookingForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const btn = e.target.querySelector('.book-submit');
  const origText = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
  btn.disabled = true;

  const payload = {
    carId: document.getElementById('book-car-id').value,
    customerName: document.getElementById('book-name').value,
    customerPhone: document.getElementById('book-phone').value,
    customerEmail: document.getElementById('book-email').value,
    pickupLocation: document.getElementById('book-pickup').value,
    dropLocation: document.getElementById('book-drop').value,
    journeyDate: document.getElementById('book-date').value,
    journeyTime: document.getElementById('book-time').value,
    estimatedKm: document.getElementById('est-km').value || 0,
    notes: document.getElementById('book-notes').value
  };

  try {
    const resp = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();

    if (data.success) {
      closeBooking();
      document.getElementById('success-booking-id').textContent = 'Booking ID: ' + data.bookingId;
      document.getElementById('successModal').classList.add('open');
      document.body.style.overflow = 'hidden';
      e.target.reset();
    } else {
      showToast('❌ Booking failed. Please try again or call 9411061000', 'error');
    }
  } catch (err) {
    showToast('❌ Network error. Please call 9411061000 to book.', 'error');
  } finally {
    btn.innerHTML = origText;
    btn.disabled = false;
  }
});

// ---- Quick Enquiry Form ----
document.getElementById('enquiryForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('eq-name').value;
  const phone = document.getElementById('eq-phone').value;
  const route = document.getElementById('eq-route').value;
  const date = document.getElementById('eq-date').value;

  const waMsg = encodeURIComponent(`Hi Brajwasi Travels,\n\nNew Enquiry:\n👤 Name: ${name}\n📞 Phone: ${phone}\n🗺 Route: ${route}\n📅 Date: ${date}\n\nPlease confirm availability.`);
  window.open(`https://wa.me/919411061000?text=${waMsg}`, '_blank');
  e.target.reset();
  showToast('✅ Redirecting to WhatsApp...', 'success');
});

// ---- Toast Notification ----
function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = message;
  toast.style.cssText = `
    position: fixed; bottom: 90px; right: 20px; z-index: 99999;
    background: ${type === 'success' ? '#1a3a2a' : '#3a1a1a'};
    border: 1px solid ${type === 'success' ? '#3fb950' : '#f85149'};
    color: ${type === 'success' ? '#3fb950' : '#f85149'};
    padding: 14px 20px; border-radius: 10px; font-size: 14px; font-weight: 500;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4); max-width: 320px;
    animation: fadeInUp 0.3s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ---- Intersection Observer for animations ----
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.car-card, .feature-card, .pricing-explain-card').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(20px)';
  el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
  observer.observe(el);
});

// ---- Init ----
initPushNotifications();
