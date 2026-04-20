require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const webpush = require('web-push');
const connectDB = require('./config/db');
const { Car, Booking, PushSubscription, ChatMessage, Testimonial, CarPartner, OtpRecord } = require('./models');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const app = express();

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:brajwasitravels.1980@gmail.com',
    process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY
  );
}

connectDB();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'brajwasi_2024_secret',
  resave: false, saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true }
}));

// ── File storage ─────────────────────────────────────────────
['public/uploads','public/uploads/docs'].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
const imgStorage = multer.diskStorage({ destination: (_, f, cb) => cb(null, 'public/uploads/'), filename: (_, f, cb) => cb(null, Date.now() + '-' + f.fieldname + path.extname(f.originalname)) });
const docStorage = multer.diskStorage({ destination: (_, f, cb) => cb(null, 'public/uploads/docs/'), filename: (_, f, cb) => cb(null, Date.now() + '-' + f.fieldname + path.extname(f.originalname)) });
const imgFilter = (_, f, cb) => f.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Images only'));
const docFilter = (_, f, cb) => ['image/jpeg','image/png','image/webp','application/pdf'].includes(f.mimetype) ? cb(null, true) : cb(new Error('Image/PDF only'));
const uploadImg  = multer({ storage: imgStorage, limits: { fileSize: 5e6 }, fileFilter: imgFilter });
const uploadDocs = multer({ storage: docStorage, limits: { fileSize: 10e6 }, fileFilter: docFilter });

// ── Helpers ──────────────────────────────────────────────────
const phoneHash = p => crypto.createHash('md5').update(p.trim()).digest('hex');
const genOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendPushTo = async (subs, title, body, data = {}) => {
  if (!subs?.length) return;
  const payload = JSON.stringify({ title, body, ...data });
  await Promise.allSettled(subs.map(s => webpush.sendNotification(s, payload).catch(async e => { if (e.statusCode === 410) await PushSubscription.deleteOne({ endpoint: s.endpoint }); })));
};
const pushAdmin    = async (t, b, d = {}) => sendPushTo(await PushSubscription.find({ role: 'admin' }), t, b, d);
const pushCustomer = async (phone, t, b, d = {}) => { if (!phone) return; sendPushTo(await PushSubscription.find({ role: 'customer', phone: phone.trim() }), t, b, d); };

const transporter = () => nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
const sendEmail = async (to, subject, html) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return console.log('⚠ EMAIL_USER/PASS not set');
  try { const info = await transporter().sendMail({ from: `"Brajwasi Tour & Travels" <${process.env.EMAIL_USER}>`, to, subject, html }); console.log('✅ Email:', info.messageId); }
  catch(e) { console.log('❌ Email error:', e.message); }
};

const adminAuth = (req, res, next) => req.session.admin ? next() : res.redirect('/admin/login');
const customerAuth = (req, res, next) => req.session.customer ? next() : res.status(401).json({ error: 'Login required', loginRequired: true });

// ════════════════════════════════════════════════════════════
//  UTILITY / SEO ROUTES
// ════════════════════════════════════════════════════════════

// Ping route for UptimeRobot / BetterStack
app.get('/ping', (_, res) => res.status(200).json({ status: 'ok', ts: Date.now(), service: 'Brajwasi Travels' }));
app.get('/health', (_, res) => res.status(200).send('OK'));

// Sitemap
app.get('/sitemap.xml', (_, res) => {
  const base = 'https://brajwasi-travels.onrender.com';
  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>${base}/track</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>${base}/partner</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>
</urlset>`);
});

// Robots.txt
app.get('/robots.txt', (_, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\nSitemap: https://brajwasi-travels.onrender.com/sitemap.xml`);
});

// ════════════════════════════════════════════════════════════
//  CUSTOMER AUTH (OTP via email)
// ════════════════════════════════════════════════════════════

// Send OTP
app.post('/api/auth/send-otp', async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const otp = genOtp();
  const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  await OtpRecord.findOneAndUpdate({ email }, { email, name: name || '', otp, expiry }, { upsert: true, new: true });
  await sendEmail(email, `Your Brajwasi Travels Login OTP: ${otp}`,
    `<div style="font-family:Arial;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#B8780A">🔐 Your Login OTP</h2>
      <p>Hello${name ? ' ' + name : ''},</p>
      <p>Your one-time password to login to Brajwasi Travels is:</p>
      <div style="font-size:36px;font-weight:800;color:#B8780A;letter-spacing:8px;text-align:center;padding:20px;background:#FFF8EC;border-radius:12px;margin:20px 0">${otp}</div>
      <p style="color:#7a6a55;font-size:13px">This OTP expires in 10 minutes. Do not share it with anyone.</p>
    </div>`);
  res.json({ success: true });
});

// Verify OTP
app.post('/api/auth/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  const record = await OtpRecord.findOne({ email });
  if (!record || record.otp !== otp) return res.status(400).json({ error: 'Invalid OTP' });
  if (new Date() > record.expiry) return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
  await OtpRecord.deleteOne({ email });
  req.session.customer = { email, name: record.name || email.split('@')[0] };
  res.json({ success: true, name: req.session.customer.name, email });
});

app.get('/api/auth/me', (req, res) => {
  if (req.session.customer) res.json({ loggedIn: true, ...req.session.customer });
  else res.json({ loggedIn: false });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.customer = null;
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ════════════════════════════════════════════════════════════
app.get('/', async (req, res) => {
  const [cars, testimonials] = await Promise.all([
    Car.find({ isActive: true }),
    Testimonial.find({ approved: true }).sort({ createdAt: -1 }).limit(9)
  ]);
  res.render('index', { cars, testimonials });
});

app.get('/vapid-public-key', (_, res) => res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' }));

app.post('/subscribe', async (req, res) => {
  const { endpoint, keys, role, phone } = req.body;
  await PushSubscription.findOneAndUpdate({ endpoint }, { endpoint, keys, role: role || 'customer', phone: phone || '' }, { upsert: true, new: true });
  res.json({ success: true });
});

// ── Booking (requires customer login) ───────────────────────
app.post('/api/book', customerAuth, async (req, res) => {
  try {
    const { carId, customerName, customerPhone, pickupLocation, dropLocation, journeyDate, journeyTime, estimatedKm, notes } = req.body;
    const customerEmail = req.session.customer.email;
    if (!estimatedKm || +estimatedKm < 1) return res.status(400).json({ error: 'Estimated KM is required and must be at least 1' });
    const car = await Car.findById(carId);
    if (!car) return res.status(404).json({ error: 'Car not found' });
    const km = Number(estimatedKm);
    let totalPrice = 0;
    if (car.fixedPackage?.km && km <= car.fixedPackage.km) totalPrice = car.fixedPackage.price;
    else if (car.fixedPackage?.km) totalPrice = car.fixedPackage.price + ((km - car.fixedPackage.km) * car.extraKmCharge);
    else totalPrice = km * car.pricePerKm;
    const bookingId = 'BT-' + uuidv4().split('-')[0].toUpperCase();
    const booking = await Booking.create({
      bookingId, car: carId, carName: `${car.name} ${car.model}`,
      customerName, customerPhone, customerEmail, pickupLocation, dropLocation,
      journeyDate: new Date(journeyDate), journeyTime, estimatedKm: km, totalPrice, notes,
      status: 'pending', advancePaid: false, advanceConfirmedByAdmin: false
    });
    await pushAdmin('🚗 New Booking!', `${customerName} · ${car.model} · ${pickupLocation} → ${dropLocation}`, { url: '/admin/bookings', bookingId });
    await pushCustomer(customerPhone, '🎉 Booking Received!', `Hi ${customerName}! Booking ${bookingId} received. We will confirm shortly.`, { url: '/track?bookingId=' + bookingId });
    await sendEmail(process.env.EMAIL_TO || process.env.EMAIL_USER, `🚗 New Booking ${bookingId} – ${customerName}`,
      `<div style="font-family:Arial;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8ddd0">
        <div style="background:linear-gradient(135deg,#B8780A,#8A5A06);padding:20px 24px"><h2 style="color:#fff;margin:0">🚗 New Booking – ${bookingId}</h2></div>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr style="background:#fff8ec"><td style="padding:11px 18px;font-weight:700;border-bottom:1px solid #f0ebe3">Booking ID</td><td style="padding:11px 18px;border-bottom:1px solid #f0ebe3;color:#B8780A;font-weight:800">${bookingId}</td></tr>
          <tr><td style="padding:11px 18px;color:#7a6a55;border-bottom:1px solid #f0ebe3">Customer</td><td style="padding:11px 18px;border-bottom:1px solid #f0ebe3;font-weight:600">${customerName} · ${customerPhone}</td></tr>
          <tr style="background:#fff8ec"><td style="padding:11px 18px;color:#7a6a55;border-bottom:1px solid #f0ebe3">Email</td><td style="padding:11px 18px;border-bottom:1px solid #f0ebe3">${customerEmail}</td></tr>
          <tr><td style="padding:11px 18px;color:#7a6a55;border-bottom:1px solid #f0ebe3">Car</td><td style="padding:11px 18px;border-bottom:1px solid #f0ebe3;font-weight:600">${car.name} ${car.model}</td></tr>
          <tr style="background:#fff8ec"><td style="padding:11px 18px;color:#7a6a55;border-bottom:1px solid #f0ebe3">Route</td><td style="padding:11px 18px;border-bottom:1px solid #f0ebe3">${pickupLocation} → ${dropLocation}</td></tr>
          <tr><td style="padding:11px 18px;color:#7a6a55;border-bottom:1px solid #f0ebe3">Date & Time</td><td style="padding:11px 18px;border-bottom:1px solid #f0ebe3">${journeyDate} at ${journeyTime}</td></tr>
          <tr style="background:#fff8ec"><td style="padding:11px 18px;color:#7a6a55;border-bottom:1px solid #f0ebe3">Est. KM</td><td style="padding:11px 18px;border-bottom:1px solid #f0ebe3">${km} km</td></tr>
          <tr><td style="padding:11px 18px;color:#7a6a55">Est. Fare</td><td style="padding:11px 18px;color:#1A7A3A;font-weight:800;font-size:15px">₹${totalPrice.toLocaleString('en-IN')}</td></tr>
        </table>
        <div style="background:#B8780A;padding:12px 24px;text-align:center"><p style="color:#fff;margin:0;font-size:13px">Login to admin panel to confirm and assign this booking</p></div>
      </div>`);
    res.json({ success: true, bookingId, totalPrice });
  } catch(e) { console.error('Booking error:', e); res.status(500).json({ error: e.message }); }
});

// ── Payment ──────────────────────────────────────────────────
app.get('/api/payment/:bookingId', async (req, res) => {
  const booking = await Booking.findOne({ bookingId: req.params.bookingId });
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  const upiId = process.env.UPI_ID;
  if (!upiId) return res.status(500).json({ error: 'UPI_ID not configured' });
  const pn = encodeURIComponent('Brajwasi Tour & Travels'), tn = encodeURIComponent('Advance ' + booking.bookingId);
  const base = `pa=${upiId}&pn=${pn}&am=500.00&tn=${tn}&cu=INR`;
  res.json({ upiId, bookingId: booking.bookingId, upiUrl: `upi://pay?${base}`, phonepe: `phonepe://pay?${base}`, gpay: `tez://upi/pay?${base}`, paytm: `paytmmp://pay?${base}`, qrData: `upi://pay?${base}` });
});
app.post('/api/payment/:bookingId/confirm', async (req, res) => {
  // Customer flags payment made — admin must confirm it
  await Booking.findOneAndUpdate({ bookingId: req.params.bookingId }, { advancePaid: true });
  res.json({ success: true });
});

// ── Tracking ─────────────────────────────────────────────────
app.get('/api/track', async (req, res) => {
  const { bookingId, phone } = req.query;
  let b;
  if (bookingId) b = await Booking.findOne({ bookingId: bookingId.trim().toUpperCase() });
  else if (phone) b = await Booking.findOne({ customerPhone: phone.trim() }).sort({ createdAt: -1 });
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  res.json({ bookingId: b.bookingId, customerName: b.customerName, carName: b.carName, pickupLocation: b.pickupLocation, dropLocation: b.dropLocation, journeyDate: b.journeyDate, journeyTime: b.journeyTime, status: b.status, advancePaid: b.advancePaid, advanceConfirmedByAdmin: b.advanceConfirmedByAdmin, totalPrice: b.totalPrice, finalFare: b.finalFare, actualKm: b.actualKm, assignedPartnerName: b.assignedPartnerName, driverLat: b.driverLat, driverLng: b.driverLng, driverLastSeen: b.driverLastSeen });
});

app.get('/track', (_, res) => res.render('track'));
app.get('/driver', (_, res) => res.render('driver'));

// ── Driver location sharing (from PWA) ──────────────────────
app.post('/api/driver/location', async (req, res) => {
  const { bookingId, lat, lng, secret } = req.body;
  // Secret matches either global DRIVER_SECRET env or partner's own driverSecret
  const globalSecret = process.env.DRIVER_SECRET || 'brajwasi_driver';
  const partner = await CarPartner.findOne({ driverSecret: secret });
  if (secret !== globalSecret && !partner) return res.status(403).json({ error: 'Invalid secret' });
  await Booking.findOneAndUpdate({ bookingId }, { driverLat: +lat, driverLng: +lng, driverLastSeen: new Date() });
  res.json({ success: true });
});

// Driver uploads actual KM after trip
app.post('/api/driver/complete', async (req, res) => {
  const { bookingId, actualKm, secret } = req.body;
  const globalSecret = process.env.DRIVER_SECRET || 'brajwasi_driver';
  const partner = await CarPartner.findOne({ driverSecret: secret });
  if (secret !== globalSecret && !partner) return res.status(403).json({ error: 'Invalid secret' });
  const booking = await Booking.findOne({ bookingId });
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  // Calculate final fare using actual km
  const car = await Car.findById(booking.car);
  const km = Number(actualKm);
  let finalFare = 0;
  if (car) {
    if (car.fixedPackage?.km && km <= car.fixedPackage.km) finalFare = car.fixedPackage.price;
    else if (car.fixedPackage?.km) finalFare = car.fixedPackage.price + ((km - car.fixedPackage.km) * car.extraKmCharge);
    else finalFare = km * car.pricePerKm;
  }
  // Subtract 500 advance only if confirmed by admin
  const advanceDeducted = booking.advanceConfirmedByAdmin ? 500 : 0;
  const balanceDue = Math.max(0, finalFare - advanceDeducted);
  await Booking.findOneAndUpdate({ bookingId }, { actualKm: km, finalFare, status: 'completed' });
  // Notify admin
  await pushAdmin('🏁 Trip Completed', `${booking.customerName} · ${bookingId} · ${km}km · ₹${finalFare}`, { url: '/admin/bookings' });
  res.json({ success: true, actualKm: km, finalFare, advanceDeducted, balanceDue });
});

// ── Driver secret OTP reset ──────────────────────────────────
app.post('/api/driver/reset-secret/send-otp', async (req, res) => {
  const { email } = req.body;
  const partner = await CarPartner.findOne({ email });
  if (!partner) return res.status(404).json({ error: 'No partner found with this email' });
  const otp = genOtp();
  await CarPartner.findByIdAndUpdate(partner._id, { resetOtp: otp, resetOtpExpiry: new Date(Date.now() + 10 * 60000) });
  await sendEmail(email, `Brajwasi Driver Secret Reset OTP: ${otp}`,
    `<div style="font-family:Arial;max-width:400px;padding:24px"><h2 style="color:#B8780A">Reset Your Driver Secret</h2>
     <p>Your OTP: <strong style="font-size:28px;color:#B8780A;letter-spacing:4px">${otp}</strong></p>
     <p>Expires in 10 minutes.</p></div>`);
  res.json({ success: true });
});

app.post('/api/driver/reset-secret/verify', async (req, res) => {
  const { email, otp, newSecret } = req.body;
  if (!newSecret || newSecret.length < 6) return res.status(400).json({ error: 'Secret must be at least 6 characters' });
  const partner = await CarPartner.findOne({ email });
  if (!partner || partner.resetOtp !== otp) return res.status(400).json({ error: 'Invalid OTP' });
  if (new Date() > partner.resetOtpExpiry) return res.status(400).json({ error: 'OTP expired' });
  await CarPartner.findByIdAndUpdate(partner._id, { driverSecret: newSecret, resetOtp: null, resetOtpExpiry: null });
  res.json({ success: true });
});

// ── Chat ─────────────────────────────────────────────────────
app.post('/api/chat/send', async (req, res) => {
  const { customerName, customerPhone, message } = req.body;
  if (!customerName || !customerPhone || !message) return res.status(400).json({ error: 'Missing fields' });
  const sessionId = phoneHash(customerPhone);
  const msg = await ChatMessage.create({ sessionId, customerName: customerName.trim(), customerPhone: customerPhone.trim(), message: message.trim(), fromCustomer: true, read: false });
  await pushAdmin(`💬 ${customerName}`, message.substring(0, 100), { url: '/admin', isChat: true, sessionId });
  res.json({ success: true, sessionId, _id: msg._id });
});
app.get('/api/chat/:phone/history', async (req, res) => {
  const messages = await ChatMessage.find({ sessionId: phoneHash(req.params.phone) }).sort({ createdAt: 1 }).limit(200);
  res.json({ messages });
});
app.get('/api/chat/:phone/updates', async (req, res) => {
  const since = req.query.since ? new Date(req.query.since) : new Date(0);
  const messages = await ChatMessage.find({ sessionId: phoneHash(req.params.phone), createdAt: { $gt: since } }).sort({ createdAt: 1 });
  res.json({ messages });
});

// ── Testimonials ─────────────────────────────────────────────
app.post('/api/testimonials', async (req, res) => {
  const { name, phone, rating, message } = req.body;
  if (!name || !phone || !rating || !message) return res.status(400).json({ error: 'All fields required' });
  await Testimonial.create({ name: name.trim(), phone: phone.trim(), rating: Math.min(5, Math.max(1, +rating)), message: message.trim().substring(0, 500) });
  res.json({ success: true });
});

// ── Partner Registration ─────────────────────────────────────
app.get('/partner', (_, res) => res.render('partner'));
app.post('/api/partner/register', uploadDocs.fields([
  { name: 'licensePhoto', maxCount: 1 }, { name: 'rcPhoto', maxCount: 1 }, { name: 'insurancePhoto', maxCount: 1 }
]), async (req, res) => {
  try {
    const { ownerName, phone, email, carName, carModel, carNumber, seats, ac, pricePerKm, fixedKm, fixedPrice, extraKmCharge, driverSecret } = req.body;
    if (!ownerName || !phone || !email || !carName || !carModel || !carNumber || !pricePerKm || !extraKmCharge || !driverSecret)
      return res.status(400).json({ error: 'All required fields must be filled' });
    if (driverSecret.length < 6) return res.status(400).json({ error: 'Driver secret must be at least 6 characters' });
    if (!req.files?.licensePhoto || !req.files?.rcPhoto || !req.files?.insurancePhoto)
      return res.status(400).json({ error: 'All three documents (licence, RC, insurance) are required' });
    const existing = await CarPartner.findOne({ $or: [{ phone }, { carNumber: carNumber.toUpperCase() }] });
    if (existing) return res.status(400).json({ error: 'A partner with this phone or car number already exists' });
    const partner = await CarPartner.create({
      ownerName: ownerName.trim(), phone: phone.trim(), email: email.trim().toLowerCase(),
      carName: carName.trim(), carModel: carModel.trim(), carNumber: carNumber.trim().toUpperCase(),
      seats: +seats || 7, ac: ac === 'true', pricePerKm: +pricePerKm, extraKmCharge: +extraKmCharge,
      fixedKm: fixedKm ? +fixedKm : undefined, fixedPrice: fixedPrice ? +fixedPrice : undefined,
      licensePhoto: '/uploads/docs/' + req.files.licensePhoto[0].filename,
      rcPhoto: '/uploads/docs/' + req.files.rcPhoto[0].filename,
      insurancePhoto: '/uploads/docs/' + req.files.insurancePhoto[0].filename,
      driverSecret: driverSecret.trim(), status: 'pending', commissionPct: 10
    });
    await pushAdmin('🚗 New Partner Registration', `${ownerName} · ${carModel} (${carNumber})`, { url: '/admin' });
    await sendEmail(process.env.EMAIL_TO || process.env.EMAIL_USER, `New Partner: ${ownerName}`,
      `<div style="font-family:Arial;max-width:480px"><h2 style="color:#B8780A">New Partner Registration</h2><p><b>Name:</b> ${ownerName}</p><p><b>Phone:</b> ${phone}</p><p><b>Car:</b> ${carModel} (${carNumber})</p><p>Login to admin to review.</p></div>`);
    res.json({ success: true, partnerId: partner._id });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ════════════════════════════════════════════════════════════
app.get('/admin', adminAuth, async (req, res) => {
  const [cars, bookings, chatSessions, pendingPartners, pendingTestimonials] = await Promise.all([
    Car.find().sort({ createdAt: -1 }),
    Booking.find().sort({ createdAt: -1 }).limit(10),
    ChatMessage.aggregate([
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$sessionId', customerName: { $first: '$customerName' }, customerPhone: { $first: '$customerPhone' }, lastMessage: { $first: '$message' }, lastTime: { $first: '$createdAt' },
          totalUnread: { $sum: { $cond: { if: { $and: [{ $eq: ['$fromCustomer', true] }, { $eq: ['$read', false] }] }, then: 1, else: 0 } } } } },
      { $sort: { lastTime: -1 } }
    ]),
    CarPartner.countDocuments({ status: 'pending' }),
    Testimonial.countDocuments({ approved: false })
  ]);
  const stats = { totalCars: await Car.countDocuments({ isActive: true }), totalBookings: await Booking.countDocuments(), pendingBookings: await Booking.countDocuments({ status: 'pending' }), confirmedBookings: await Booking.countDocuments({ status: 'confirmed' }), pendingPartners, pendingTestimonials };
  res.render('admin/dashboard', { cars, bookings, stats, chatSessions });
});

app.get('/admin/login', (req, res) => { if (req.session.admin) return res.redirect('/admin'); res.render('admin/login', { error: null }); });
app.post('/admin/login', (req, res) => {
  if (req.body.username === (process.env.ADMIN_USERNAME || 'admin') && req.body.password === (process.env.ADMIN_PASSWORD || 'brajwasi@2024')) {
    req.session.admin = true; res.redirect('/admin');
  } else { res.render('admin/login', { error: 'Invalid credentials' }); }
});
app.get('/admin/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });

// Cars CRUD
app.post('/admin/cars/add', adminAuth, uploadImg.single('image'), async (req, res) => {
  const { name, model, pricePerKm, fixedKm, fixedPrice, extraKmCharge, tollTax, availableIn, seats, ac, description } = req.body;
  await Car.create({ name, model, image: req.file ? '/uploads/' + req.file.filename : '/images/default-crysta.jpg', pricePerKm: +pricePerKm, extraKmCharge: +extraKmCharge, fixedPackage: (fixedKm && fixedPrice) ? { km: +fixedKm, price: +fixedPrice } : undefined, tollTax: tollTax || 'As per actual', availableIn: availableIn ? availableIn.split(',').map(s => s.trim()) : ['Agra'], seats: +seats || 7, ac: ac === 'true', description });
  res.redirect('/admin');
});
app.get('/admin/cars/:id/edit', adminAuth, async (req, res) => { const car = await Car.findById(req.params.id); if (!car) return res.redirect('/admin'); res.render('admin/edit-car', { car }); });
app.post('/admin/cars/:id/edit', adminAuth, uploadImg.single('image'), async (req, res) => {
  const { name, model, pricePerKm, fixedKm, fixedPrice, extraKmCharge, tollTax, availableIn, seats, ac, description } = req.body;
  const upd = { name, model, pricePerKm: +pricePerKm, extraKmCharge: +extraKmCharge, fixedPackage: (fixedKm && fixedPrice) ? { km: +fixedKm, price: +fixedPrice } : { km: 0, price: 0 }, tollTax, availableIn: availableIn ? availableIn.split(',').map(s => s.trim()) : ['Agra'], seats: +seats || 7, ac: ac === 'true', description };
  if (req.file) upd.image = '/uploads/' + req.file.filename;
  await Car.findByIdAndUpdate(req.params.id, upd); res.redirect('/admin');
});
app.post('/admin/cars/:id/toggle', adminAuth, async (req, res) => { const car = await Car.findById(req.params.id); if (car) { car.isActive = !car.isActive; await car.save(); } res.json({ success: true, isActive: car?.isActive ?? false }); });
app.post('/admin/cars/:id/delete', adminAuth, async (req, res) => { await Car.findByIdAndDelete(req.params.id); res.redirect('/admin'); });

// Bookings
app.get('/admin/bookings', adminAuth, async (req, res) => {
  const [bookings, partners] = await Promise.all([Booking.find().populate('car').sort({ createdAt: -1 }), CarPartner.find({ status: 'approved' }).select('ownerName phone carModel carNumber')]);
  res.render('admin/bookings', { bookings, partners });
});
app.post('/admin/bookings/:id/status', adminAuth, async (req, res) => {
  const booking = await Booking.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
  if (req.body.status === 'confirmed') await pushCustomer(booking.customerPhone, '✅ Booking Confirmed!', `Hi ${booking.customerName}! Booking ${booking.bookingId} confirmed.`, { url: '/track?bookingId=' + booking.bookingId });
  else if (req.body.status === 'cancelled') await pushCustomer(booking.customerPhone, '❌ Booking Cancelled', `Booking ${booking.bookingId} cancelled. Call 9411061000.`, { url: '/track?bookingId=' + booking.bookingId });
  res.redirect('/admin/bookings');
});
app.post('/admin/bookings/:id/confirm-advance', adminAuth, async (req, res) => {
  const b = await Booking.findByIdAndUpdate(req.params.id, { advancePaid: true, advanceConfirmedByAdmin: true }, { new: true });
  await pushCustomer(b.customerPhone, '✅ Advance Confirmed!', `₹500 advance for booking ${b.bookingId} confirmed by admin.`);
  res.json({ success: true });
});
app.post('/admin/bookings/:id/assign', adminAuth, async (req, res) => {
  const partner = await CarPartner.findById(req.body.partnerId);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });
  const booking = await Booking.findByIdAndUpdate(req.params.id, { assignedPartner: req.body.partnerId, assignedPartnerName: `${partner.ownerName} (${partner.carModel} · ${partner.carNumber})` }, { new: true });
  const commission = Math.round((booking.totalPrice || 0) * partner.commissionPct / 100);
  const earning = (booking.totalPrice || 0) - commission;
  await sendEmail(partner.email, `Booking Assigned – ${booking.bookingId}`,
    `<div style="font-family:Arial;max-width:540px;margin:0 auto;border:1px solid #e8ddd0;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#B8780A,#8A5A06);padding:18px 22px"><h2 style="color:#fff;margin:0">🚗 New Booking Assigned</h2></div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr style="background:#fff8ec"><td style="padding:10px 18px;font-weight:700;border-bottom:1px solid #f0ebe3">Booking ID</td><td style="padding:10px 18px;border-bottom:1px solid #f0ebe3;color:#B8780A;font-weight:800">${booking.bookingId}</td></tr>
        <tr><td style="padding:10px 18px;color:#7a6a55;border-bottom:1px solid #f0ebe3">Customer</td><td style="padding:10px 18px;border-bottom:1px solid #f0ebe3">${booking.customerName} · ${booking.customerPhone}</td></tr>
        <tr style="background:#fff8ec"><td style="padding:10px 18px;color:#7a6a55;border-bottom:1px solid #f0ebe3">Route</td><td style="padding:10px 18px;border-bottom:1px solid #f0ebe3">${booking.pickupLocation} → ${booking.dropLocation}</td></tr>
        <tr><td style="padding:10px 18px;color:#7a6a55;border-bottom:1px solid #f0ebe3">Date & Time</td><td style="padding:10px 18px;border-bottom:1px solid #f0ebe3">${new Date(booking.journeyDate).toLocaleDateString('en-IN')} at ${booking.journeyTime}</td></tr>
        <tr style="background:#fff8ec"><td style="padding:10px 18px;color:#7a6a55;border-bottom:1px solid #f0ebe3">Total Fare</td><td style="padding:10px 18px;border-bottom:1px solid #f0ebe3;color:#1A7A3A;font-weight:700">₹${(booking.totalPrice||0).toLocaleString('en-IN')}</td></tr>
        <tr><td style="padding:10px 18px;color:#7a6a55;border-bottom:1px solid #f0ebe3">Commission (${partner.commissionPct}%)</td><td style="padding:10px 18px;border-bottom:1px solid #f0ebe3;color:#C0392B">− ₹${commission.toLocaleString('en-IN')}</td></tr>
        <tr style="background:#fff8ec"><td style="padding:10px 18px;font-weight:700">Your Earning</td><td style="padding:10px 18px;color:#1A7A3A;font-weight:800;font-size:16px">₹${earning.toLocaleString('en-IN')}</td></tr>
      </table>
      <div style="padding:14px 18px;background:#fff8ec;font-size:13px;color:#7a6a55">After completing the trip, use the Driver app to upload actual KM and your earnings will be finalised.</div>
    </div>`);
  res.json({ success: true, assignedPartnerName: booking.assignedPartnerName });
});

// Push
app.post('/admin/push', adminAuth, async (req, res) => { await pushAdmin(req.body.title, req.body.body); res.json({ success: true }); });

// Chat admin
app.get('/admin/chat/:sessionId/messages', adminAuth, async (req, res) => {
  const messages = await ChatMessage.find({ sessionId: req.params.sessionId }).sort({ createdAt: 1 });
  await ChatMessage.updateMany({ sessionId: req.params.sessionId, fromCustomer: true, read: false }, { $set: { read: true } });
  res.json({ messages });
});
app.post('/admin/chat/:sessionId/reply', adminAuth, async (req, res) => {
  if (!req.body.message) return res.status(400).json({ error: 'Message required' });
  const existing = await ChatMessage.findOne({ sessionId: req.params.sessionId });
  if (!existing) return res.status(404).json({ error: 'Session not found' });
  await ChatMessage.create({ sessionId: req.params.sessionId, customerName: existing.customerName, customerPhone: existing.customerPhone, message: req.body.message.trim(), fromCustomer: false, read: true });
  await pushCustomer(existing.customerPhone, '💬 Brajwasi replied', req.body.message.substring(0, 100), { url: '/', isChat: true });
  res.json({ success: true });
});
app.delete('/admin/chat/:sessionId', adminAuth, async (req, res) => { await ChatMessage.deleteMany({ sessionId: req.params.sessionId }); res.json({ success: true }); });
app.get('/admin/chat/:sessionId/updates', adminAuth, async (req, res) => {
  const since = req.query.since ? new Date(req.query.since) : new Date(0);
  const messages = await ChatMessage.find({ sessionId: req.params.sessionId, createdAt: { $gt: since } }).sort({ createdAt: 1 });
  await ChatMessage.updateMany({ sessionId: req.params.sessionId, fromCustomer: true, read: false }, { $set: { read: true } });
  res.json({ messages });
});

// Testimonials admin
app.get('/admin/testimonials', adminAuth, async (req, res) => { res.render('admin/testimonials', { testimonials: await Testimonial.find().sort({ createdAt: -1 }) }); });
app.post('/admin/testimonials/:id/approve', adminAuth, async (req, res) => { await Testimonial.findByIdAndUpdate(req.params.id, { approved: true }); res.json({ success: true }); });
app.post('/admin/testimonials/:id/reject', adminAuth, async (req, res) => { await Testimonial.findByIdAndDelete(req.params.id); res.json({ success: true }); });

// Partners admin
app.get('/admin/partners', adminAuth, async (req, res) => { res.render('admin/partners', { partners: await CarPartner.find().sort({ createdAt: -1 }) }); });
app.post('/admin/partners/:id/approve', adminAuth, async (req, res) => {
  const p = await CarPartner.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true });
  await sendEmail(p.email, 'Registration Approved – Brajwasi Tour & Travels',
    `<div style="font-family:Arial;max-width:480px"><h2 style="color:#1A7A3A">✅ Registration Approved!</h2><p>Hello ${p.ownerName},</p><p>Your car ${p.carModel} (${p.carNumber}) is approved. You'll receive booking assignments by email. Remember: ${p.commissionPct}% commission applies.</p><p style="color:#7a6a55;font-size:13px">Your driver secret code: <strong>${p.driverSecret}</strong> — use this in the Driver app to share your location.</p></div>`);
  res.json({ success: true });
});
app.post('/admin/partners/:id/reject', adminAuth, async (req, res) => {
  const p = await CarPartner.findByIdAndUpdate(req.params.id, { status: 'rejected' }, { new: true });
  await sendEmail(p.email, 'Registration Update – Brajwasi Tour & Travels', `<div style="font-family:Arial;max-width:480px"><h2 style="color:#C0392B">Registration Not Approved</h2><p>Hello ${p.ownerName}, unfortunately your registration could not be approved. Please call 9411061000.</p></div>`);
  res.json({ success: true });
});
app.delete('/admin/partners/:id/doc', adminAuth, async (req, res) => {
  const allowed = ['licensePhoto','rcPhoto','insurancePhoto'];
  const { docField } = req.body;
  if (!allowed.includes(docField)) return res.status(400).json({ error: 'Invalid field' });
  const p = await CarPartner.findById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p[docField]) { try { fs.unlinkSync(path.join(__dirname, 'public', p[docField])); } catch(e) {} }
  await CarPartner.findByIdAndUpdate(req.params.id, { [docField]: null });
  res.json({ success: true });
});
app.delete('/admin/partners/:id', adminAuth, async (req, res) => { await CarPartner.findByIdAndDelete(req.params.id); res.redirect('/admin/partners'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Brajwasi running on port ${PORT}`));
