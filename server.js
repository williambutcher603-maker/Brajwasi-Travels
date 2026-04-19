require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const webpush = require('web-push');
const connectDB = require('./config/db');
const { Car, Booking, PushSubscription, ChatMessage } = require('./models');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const fs = require('fs');

const app = express();

// ── WebPush ──────────────────────────────────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:brajwasitravels.1980@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

connectDB();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'brajwasi_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// ── Multer ───────────────────────────────────────────────────
if (!fs.existsSync('public/uploads')) fs.mkdirSync('public/uploads', { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Images only'))
});

// ── Push helper ──────────────────────────────────────────────
const pushAll = async (title, body, data = {}) => {
  try {
    const subs = await PushSubscription.find();
    const payload = JSON.stringify({ title, body, ...data });
    await Promise.allSettled(subs.map(s =>
      webpush.sendNotification(s, payload).catch(async e => {
        if (e.statusCode === 410) await PushSubscription.deleteOne({ endpoint: s.endpoint });
      })
    ));
  } catch (e) { console.log('Push error:', e.message); }
};

// ── Email helper ─────────────────────────────────────────────
const sendEmail = async (subject, html) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return console.log('⚠ Email skipped: set EMAIL_USER and EMAIL_PASS in Render env vars');
  }
  try {
    const t = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    const info = await t.sendMail({
      from: `"Brajwasi Tour & Travels" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO || process.env.EMAIL_USER,
      subject, html
    });
    console.log('✅ Email sent:', info.messageId);
  } catch (e) { console.log('❌ Email error:', e.message); }
};

// ── Session hash ─────────────────────────────────────────────
const phoneHash = p => crypto.createHash('md5').update(p.trim()).digest('hex');

// ════════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ════════════════════════════════════════════════════════════
app.get('/', async (req, res) => {
  const cars = await Car.find({ isActive: true });
  res.render('index', { cars });
});

app.get('/vapid-public-key', (req, res) =>
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' }));

app.post('/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body;
  await PushSubscription.findOneAndUpdate({ endpoint }, { endpoint, keys }, { upsert: true, new: true });
  res.json({ success: true });
});

// ── Booking ──────────────────────────────────────────────────
app.post('/api/book', async (req, res) => {
  try {
    const { carId, customerName, customerPhone, customerEmail,
            pickupLocation, dropLocation, journeyDate, journeyTime,
            estimatedKm, notes } = req.body;

    const car = await Car.findById(carId);
    if (!car) return res.status(404).json({ error: 'Car not found' });

    const km = Number(estimatedKm) || 0;
    let totalPrice = 0;
    if (km > 0) {
      if (car.fixedPackage?.km && km <= car.fixedPackage.km) totalPrice = car.fixedPackage.price;
      else if (car.fixedPackage?.km) totalPrice = car.fixedPackage.price + ((km - car.fixedPackage.km) * car.extraKmCharge);
      else totalPrice = km * car.pricePerKm;
    }

    const bookingId = 'BT-' + uuidv4().split('-')[0].toUpperCase();
    await Booking.create({
      bookingId, car: carId, carName: `${car.name} ${car.model}`,
      customerName, customerPhone, customerEmail,
      pickupLocation, dropLocation,
      journeyDate: new Date(journeyDate), journeyTime,
      estimatedKm: km, totalPrice, notes,
      status: 'pending', advancePaid: false
    });

    await pushAll('🚗 New Booking!',
      `${customerName} · ${car.model} · ${pickupLocation} → ${dropLocation}`,
      { url: '/admin/bookings', bookingId });

    await sendEmail(`🚗 New Booking ${bookingId} – ${customerName}`,
      `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8ddd0">
        <div style="background:linear-gradient(135deg,#B8780A,#8A5A06);padding:22px 24px">
          <h2 style="color:#fff;margin:0;font-size:20px">🚗 New Booking – ${bookingId}</h2>
          <p style="color:rgba(255,255,255,.8);margin:4px 0 0;font-size:13px">Brajwasi Tour & Travels Admin Alert</p>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr style="background:#fff8ec"><td style="padding:12px 20px;font-weight:700;border-bottom:1px solid #f0ebe3;width:38%">Booking ID</td><td style="padding:12px 20px;border-bottom:1px solid #f0ebe3;color:#B8780A;font-weight:800;letter-spacing:1px">${bookingId}</td></tr>
          <tr><td style="padding:12px 20px;color:#7a6a55;font-weight:600;border-bottom:1px solid #f0ebe3">Customer</td><td style="padding:12px 20px;border-bottom:1px solid #f0ebe3;font-weight:600">${customerName}</td></tr>
          <tr style="background:#fff8ec"><td style="padding:12px 20px;color:#7a6a55;font-weight:600;border-bottom:1px solid #f0ebe3">Phone</td><td style="padding:12px 20px;border-bottom:1px solid #f0ebe3">${customerPhone}</td></tr>
          <tr><td style="padding:12px 20px;color:#7a6a55;font-weight:600;border-bottom:1px solid #f0ebe3">Email</td><td style="padding:12px 20px;border-bottom:1px solid #f0ebe3">${customerEmail || '—'}</td></tr>
          <tr style="background:#fff8ec"><td style="padding:12px 20px;color:#7a6a55;font-weight:600;border-bottom:1px solid #f0ebe3">Car</td><td style="padding:12px 20px;border-bottom:1px solid #f0ebe3;font-weight:600">${car.name} ${car.model}</td></tr>
          <tr><td style="padding:12px 20px;color:#7a6a55;font-weight:600;border-bottom:1px solid #f0ebe3">From</td><td style="padding:12px 20px;border-bottom:1px solid #f0ebe3">${pickupLocation}</td></tr>
          <tr style="background:#fff8ec"><td style="padding:12px 20px;color:#7a6a55;font-weight:600;border-bottom:1px solid #f0ebe3">To</td><td style="padding:12px 20px;border-bottom:1px solid #f0ebe3">${dropLocation}</td></tr>
          <tr><td style="padding:12px 20px;color:#7a6a55;font-weight:600;border-bottom:1px solid #f0ebe3">Date & Time</td><td style="padding:12px 20px;border-bottom:1px solid #f0ebe3">${journeyDate} at ${journeyTime}</td></tr>
          <tr style="background:#fff8ec"><td style="padding:12px 20px;color:#7a6a55;font-weight:600;border-bottom:1px solid #f0ebe3">Est. KM</td><td style="padding:12px 20px;border-bottom:1px solid #f0ebe3">${km || '—'} km</td></tr>
          <tr><td style="padding:12px 20px;color:#7a6a55;font-weight:600;border-bottom:1px solid #f0ebe3">Est. Fare</td><td style="padding:12px 20px;border-bottom:1px solid #f0ebe3;color:#1A7A3A;font-weight:800;font-size:16px">₹${totalPrice.toLocaleString('en-IN')}</td></tr>
          <tr style="background:#fff8ec"><td style="padding:12px 20px;color:#7a6a55;font-weight:600">Notes</td><td style="padding:12px 20px">${notes || '—'}</td></tr>
        </table>
        <div style="background:#B8780A;padding:14px 24px;text-align:center">
          <p style="color:#fff;margin:0;font-size:13px;font-weight:600">Login to admin panel to confirm this booking</p>
        </div>
      </div>`);

    res.json({ success: true, bookingId, totalPrice });
  } catch (err) {
    console.error('Booking error:', err);
    res.status(500).json({ error: 'Booking failed: ' + err.message });
  }
});

// ── UPI Payment ──────────────────────────────────────────────
app.get('/api/payment/:bookingId', async (req, res) => {
  const booking = await Booking.findOne({ bookingId: req.params.bookingId });
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  const upiId = process.env.UPI_ID;
  if (!upiId) return res.status(500).json({ error: 'UPI_ID not configured in environment variables' });

  const pn = encodeURIComponent('Brajwasi Tour & Travels');
  const tn = encodeURIComponent('Advance ' + booking.bookingId);
  const base = `pa=${upiId}&pn=${pn}&am=500.00&tn=${tn}&cu=INR`;

  res.json({
    upiId,
    bookingId: booking.bookingId,
    upiUrl:  `upi://pay?${base}`,
    phonepe: `phonepe://pay?${base}`,
    gpay:    `tez://upi/pay?${base}`,
    paytm:   `paytmmp://pay?${base}`,
    qrData:  `upi://pay?${base}`
  });
});

app.post('/api/payment/:bookingId/confirm', async (req, res) => {
  await Booking.findOneAndUpdate({ bookingId: req.params.bookingId }, { advancePaid: true });
  res.json({ success: true });
});

// ── Booking status tracking (public) ────────────────────────
app.get('/api/track', async (req, res) => {
  const { bookingId, phone } = req.query;
  let booking;
  if (bookingId) {
    booking = await Booking.findOne({ bookingId: bookingId.trim().toUpperCase() });
  } else if (phone) {
    booking = await Booking.findOne({ customerPhone: phone.trim() }).sort({ createdAt: -1 });
  }
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  res.json({
    bookingId: booking.bookingId,
    customerName: booking.customerName,
    carName: booking.carName,
    pickupLocation: booking.pickupLocation,
    dropLocation: booking.dropLocation,
    journeyDate: booking.journeyDate,
    journeyTime: booking.journeyTime,
    status: booking.status,
    advancePaid: booking.advancePaid,
    totalPrice: booking.totalPrice,
    driverLat: booking.driverLat,
    driverLng: booking.driverLng,
    driverLastSeen: booking.driverLastSeen
  });
});

// ── Driver location update (called by driver's phone browser) ─
app.post('/api/driver/location', async (req, res) => {
  const { bookingId, lat, lng, secret } = req.body;
  if (secret !== (process.env.DRIVER_SECRET || 'brajwasi_driver')) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  await Booking.findOneAndUpdate(
    { bookingId },
    { driverLat: lat, driverLng: lng, driverLastSeen: new Date() }
  );
  res.json({ success: true });
});

// ── Chat (public) ────────────────────────────────────────────
app.post('/api/chat/send', async (req, res) => {
  const { customerName, customerPhone, message } = req.body;
  if (!customerName || !customerPhone || !message)
    return res.status(400).json({ error: 'Missing fields' });
  const sessionId = phoneHash(customerPhone);
  const msg = await ChatMessage.create({
    sessionId, customerName: customerName.trim(),
    customerPhone: customerPhone.trim(), message: message.trim(),
    fromCustomer: true, read: false
  });
  await pushAll(`💬 ${customerName}`, message.substring(0, 100),
    { url: '/admin', isChat: true, sessionId });
  res.json({ success: true, sessionId, _id: msg._id });
});

app.get('/api/chat/:phone/history', async (req, res) => {
  const sessionId = phoneHash(req.params.phone);
  const messages = await ChatMessage.find({ sessionId }).sort({ createdAt: 1 }).limit(200);
  res.json({ messages, sessionId });
});

app.get('/api/chat/:phone/updates', async (req, res) => {
  const sessionId = phoneHash(req.params.phone);
  const since = req.query.since ? new Date(req.query.since) : new Date(0);
  const messages = await ChatMessage.find({ sessionId, createdAt: { $gt: since } }).sort({ createdAt: 1 });
  res.json({ messages });
});

// ════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ════════════════════════════════════════════════════════════
const adminAuth = (req, res, next) => req.session.admin ? next() : res.redirect('/admin/login');

app.get('/admin', adminAuth, async (req, res) => {
  const [cars, bookings] = await Promise.all([
    Car.find().sort({ createdAt: -1 }),
    Booking.find().sort({ createdAt: -1 }).limit(10)
  ]);
  const stats = {
    totalCars: await Car.countDocuments({ isActive: true }),
    totalBookings: await Booking.countDocuments(),
    pendingBookings: await Booking.countDocuments({ status: 'pending' }),
    confirmedBookings: await Booking.countDocuments({ status: 'confirmed' })
  };
  const chatSessions = await ChatMessage.aggregate([
    { $sort: { createdAt: -1 } },
    { $group: {
      _id: '$sessionId',
      customerName: { $first: '$customerName' },
      customerPhone: { $first: '$customerPhone' },
      lastMessage: { $first: '$message' },
      lastTime: { $first: '$createdAt' },
      totalUnread: { $sum: { $cond: { if: { $and: [{ $eq: ['$fromCustomer', true] }, { $eq: ['$read', false] }] }, then: 1, else: 0 } } }
    }},
    { $sort: { lastTime: -1 } }
  ]);
  res.render('admin/dashboard', { cars, bookings, stats, chatSessions });
});

app.get('/admin/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');
  res.render('admin/login', { error: null });
});
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === (process.env.ADMIN_USERNAME || 'admin') &&
      password === (process.env.ADMIN_PASSWORD || 'brajwasi@2024')) {
    req.session.admin = true; res.redirect('/admin');
  } else { res.render('admin/login', { error: 'Invalid credentials' }); }
});
app.get('/admin/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });

// Cars
app.post('/admin/cars/add', adminAuth, upload.single('image'), async (req, res) => {
  const { name, model, pricePerKm, fixedKm, fixedPrice, extraKmCharge, tollTax, availableIn, seats, ac, description } = req.body;
  await Car.create({
    name, model, image: req.file ? '/uploads/' + req.file.filename : '/images/default-crysta.jpg',
    pricePerKm: +pricePerKm, extraKmCharge: +extraKmCharge,
    fixedPackage: (fixedKm && fixedPrice) ? { km: +fixedKm, price: +fixedPrice } : undefined,
    tollTax: tollTax || 'As per actual',
    availableIn: availableIn ? availableIn.split(',').map(s => s.trim()) : ['Agra'],
    seats: +seats || 7, ac: ac === 'true', description
  });
  res.redirect('/admin');
});
app.get('/admin/cars/:id/edit', adminAuth, async (req, res) => {
  const car = await Car.findById(req.params.id);
  if (!car) return res.redirect('/admin');
  res.render('admin/edit-car', { car });
});
app.post('/admin/cars/:id/edit', adminAuth, upload.single('image'), async (req, res) => {
  const { name, model, pricePerKm, fixedKm, fixedPrice, extraKmCharge, tollTax, availableIn, seats, ac, description } = req.body;
  const upd = { name, model, pricePerKm: +pricePerKm, extraKmCharge: +extraKmCharge,
    fixedPackage: (fixedKm && fixedPrice) ? { km: +fixedKm, price: +fixedPrice } : { km: 0, price: 0 },
    tollTax, availableIn: availableIn ? availableIn.split(',').map(s => s.trim()) : ['Agra'],
    seats: +seats || 7, ac: ac === 'true', description };
  if (req.file) upd.image = '/uploads/' + req.file.filename;
  await Car.findByIdAndUpdate(req.params.id, upd);
  res.redirect('/admin');
});
app.post('/admin/cars/:id/toggle', adminAuth, async (req, res) => {
  const car = await Car.findById(req.params.id);
  if (car) { car.isActive = !car.isActive; await car.save(); }
  res.json({ success: true, isActive: car?.isActive ?? false });
});
app.post('/admin/cars/:id/delete', adminAuth, async (req, res) => {
  await Car.findByIdAndDelete(req.params.id); res.redirect('/admin');
});

// Bookings
app.get('/admin/bookings', adminAuth, async (req, res) => {
  const bookings = await Booking.find().populate('car').sort({ createdAt: -1 });
  res.render('admin/bookings', { bookings });
});
app.post('/admin/bookings/:id/status', adminAuth, async (req, res) => {
  const booking = await Booking.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
  // If status changed to confirmed, push notification to customer's devices
  // (customers subscribe with their phone, but we push to all subscribers as a workaround)
  if (req.body.status === 'confirmed') {
    await pushAll('✅ Booking Confirmed!',
      `Your booking ${booking.bookingId} has been confirmed. We'll arrive on time!`,
      { url: '/track?bookingId=' + booking.bookingId, bookingId: booking.bookingId });
  }
  res.redirect('/admin/bookings');
});
app.post('/admin/bookings/:id/advance', adminAuth, async (req, res) => {
  const b = await Booking.findByIdAndUpdate(req.params.id, { advancePaid: req.body.paid === 'true' }, { new: true });
  res.json({ success: true, advancePaid: b.advancePaid });
});

// Push
app.post('/admin/push', adminAuth, async (req, res) => {
  await pushAll(req.body.title, req.body.body);
  res.json({ success: true });
});

// Chat admin
app.get('/admin/chat/:sessionId/messages', adminAuth, async (req, res) => {
  const messages = await ChatMessage.find({ sessionId: req.params.sessionId }).sort({ createdAt: 1 });
  await ChatMessage.updateMany({ sessionId: req.params.sessionId, fromCustomer: true, read: false }, { $set: { read: true } });
  res.json({ messages });
});
app.post('/admin/chat/:sessionId/reply', adminAuth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  const existing = await ChatMessage.findOne({ sessionId: req.params.sessionId });
  if (!existing) return res.status(404).json({ error: 'Session not found' });
  await ChatMessage.create({
    sessionId: req.params.sessionId, customerName: existing.customerName,
    customerPhone: existing.customerPhone, message: message.trim(),
    fromCustomer: false, read: true
  });
  res.json({ success: true });
});
app.delete('/admin/chat/:sessionId', adminAuth, async (req, res) => {
  await ChatMessage.deleteMany({ sessionId: req.params.sessionId });
  res.json({ success: true });
});
app.get('/admin/chat/:sessionId/updates', adminAuth, async (req, res) => {
  const since = req.query.since ? new Date(req.query.since) : new Date(0);
  const messages = await ChatMessage.find({ sessionId: req.params.sessionId, createdAt: { $gt: since } }).sort({ createdAt: 1 });
  await ChatMessage.updateMany({ sessionId: req.params.sessionId, fromCustomer: true, read: false }, { $set: { read: true } });
  res.json({ messages });
});

// ── Public tracking page ─────────────────────────────────────
app.get('/track', (req, res) => res.render('track'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Brajwasi running on port ${PORT}`));
