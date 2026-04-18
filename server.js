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

const app = express();

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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

const fs = require('fs');
if (!fs.existsSync('public/uploads')) fs.mkdirSync('public/uploads', { recursive: true });

// ── Push notifications ──────────────────────────────────────
const sendPushToAll = async (title, body, data = {}) => {
  try {
    const subs = await PushSubscription.find();
    const payload = JSON.stringify({ title, body, ...data });
    await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(sub, payload).catch(async (err) => {
          if (err.statusCode === 410) await PushSubscription.deleteOne({ endpoint: sub.endpoint });
        })
      )
    );
  } catch (e) { console.log('Push error:', e.message); }
};

// ── Email ────────────────────────────────────────────────────
const sendEmail = async (subject, html) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log('Email skipped: EMAIL_USER or EMAIL_PASS not set in env');
    return;
  }
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    const info = await transporter.sendMail({
      from: `"Brajwasi Tour & Travels" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO || process.env.EMAIL_USER,
      subject,
      html
    });
    console.log('Email sent:', info.messageId);
  } catch (e) {
    console.log('Email error:', e.message);
  }
};

// ── Helper: phone → sessionId ────────────────────────────────
const phoneToSession = (phone) =>
  crypto.createHash('md5').update(phone.trim()).digest('hex');

// ══════════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ══════════════════════════════════════════════════════════════

app.get('/', async (req, res) => {
  const cars = await Car.find({ isActive: true });
  res.render('index', { cars });
});

app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

app.post('/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body;
  await PushSubscription.findOneAndUpdate(
    { endpoint },
    { endpoint, keys },
    { upsert: true, new: true }
  );
  res.json({ success: true });
});

app.get('/api/car/:id/price', async (req, res) => {
  const car = await Car.findById(req.params.id);
  if (!car) return res.status(404).json({ error: 'Car not found' });
  res.json({ pricePerKm: car.pricePerKm, fixedPackage: car.fixedPackage, extraKmCharge: car.extraKmCharge, tollTax: car.tollTax });
});

// ── Book a car ───────────────────────────────────────────────
app.post('/api/book', async (req, res) => {
  try {
    const { carId, customerName, customerPhone, customerEmail,
            pickupLocation, dropLocation, journeyDate, journeyTime,
            estimatedKm, notes } = req.body;

    const car = await Car.findById(carId);
    if (!car) return res.status(404).json({ error: 'Car not found' });

    let totalPrice = 0;
    const km = Number(estimatedKm) || 0;
    if (km > 0) {
      if (car.fixedPackage?.km && km <= car.fixedPackage.km) {
        totalPrice = car.fixedPackage.price;
      } else if (car.fixedPackage?.km) {
        totalPrice = car.fixedPackage.price + ((km - car.fixedPackage.km) * car.extraKmCharge);
      } else {
        totalPrice = km * car.pricePerKm;
      }
    }

    const bookingId = 'BT-' + uuidv4().split('-')[0].toUpperCase();

    const booking = await Booking.create({
      bookingId, car: carId, carName: `${car.name} ${car.model}`,
      customerName, customerPhone, customerEmail,
      pickupLocation, dropLocation,
      journeyDate: new Date(journeyDate), journeyTime,
      estimatedKm: km, totalPrice, notes,
      status: 'pending', advancePaid: false
    });

    // Push notification
    await sendPushToAll(
      '🚗 New Booking!',
      `${customerName} · ${car.model} · ${pickupLocation} → ${dropLocation}`,
      { url: '/admin/bookings', bookingId }
    );

    // Email notification
    await sendEmail(
      `🚗 New Booking ${bookingId} – ${customerName}`,
      `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8f5f0">
      <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)">
        <div style="background:linear-gradient(135deg,#B8780A,#8A5A06);padding:24px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:22px">🚗 New Booking Received</h1>
          <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px">Brajwasi Tour & Travels – Admin Notification</p>
        </div>
        <div style="padding:0">
          <table style="width:100%;border-collapse:collapse">
            <tr style="background:#fff8ec"><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3;font-weight:700;color:#1a1208;width:38%">Booking ID</td><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3;color:#B8780A;font-weight:800;font-size:17px;letter-spacing:1.5px">${bookingId}</td></tr>
            <tr><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3;color:#7a6a55;font-weight:600">Customer</td><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3;font-weight:600">${customerName}</td></tr>
            <tr style="background:#fff8ec"><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3;color:#7a6a55;font-weight:600">Phone</td><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3">${customerPhone}</td></tr>
            <tr><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3;color:#7a6a55;font-weight:600">Email</td><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3">${customerEmail || 'Not provided'}</td></tr>
            <tr style="background:#fff8ec"><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3;color:#7a6a55;font-weight:600">Car</td><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3;font-weight:600">${car.name} ${car.model}</td></tr>
            <tr><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3;color:#7a6a55;font-weight:600">Pickup</td><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3">${pickupLocation}</td></tr>
            <tr style="background:#fff8ec"><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3;color:#7a6a55;font-weight:600">Drop</td><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3">${dropLocation}</td></tr>
            <tr><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3;color:#7a6a55;font-weight:600">Date & Time</td><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3">${journeyDate} at ${journeyTime}</td></tr>
            <tr style="background:#fff8ec"><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3;color:#7a6a55;font-weight:600">Est. Distance</td><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3">${km || 'Not specified'} km</td></tr>
            <tr><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3;color:#7a6a55;font-weight:600">Est. Fare</td><td style="padding:13px 20px;border-bottom:1px solid #f0ebe3;color:#1A7A3A;font-weight:800;font-size:18px">₹${totalPrice.toLocaleString('en-IN')}</td></tr>
            <tr style="background:#fff8ec"><td style="padding:13px 20px;color:#7a6a55;font-weight:600">Notes</td><td style="padding:13px 20px">${notes || 'None'}</td></tr>
          </table>
        </div>
        <div style="background:#B8780A;padding:16px;text-align:center">
          <p style="color:#fff;margin:0;font-size:13px;font-weight:600">Login to admin panel to confirm this booking</p>
        </div>
      </div></body></html>`
    );

    res.json({ success: true, bookingId: booking.bookingId, totalPrice });
  } catch (err) {
    console.error('Booking error:', err);
    res.status(500).json({ error: 'Booking failed', details: err.message });
  }
});

// ── UPI Payment ──────────────────────────────────────────────
app.get('/api/payment/:bookingId', async (req, res) => {
  const booking = await Booking.findOne({ bookingId: req.params.bookingId });
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  // UPI ID MUST be set in environment variable UPI_ID — no hardcoded fallback
  const upiId = process.env.UPI_ID;
  if (!upiId) return res.status(500).json({ error: 'UPI ID not configured. Set UPI_ID env variable.' });

  const amount = '500.00';
  const pn = encodeURIComponent('Brajwasi Tour & Travels');
  const tn = encodeURIComponent('Advance ' + booking.bookingId);

  const upiUrl  = `upi://pay?pa=${upiId}&pn=${pn}&am=${amount}&tn=${tn}&cu=INR`;
  const phonepe = `phonepe://pay?pa=${upiId}&pn=${pn}&am=${amount}&tn=${tn}&cu=INR`;
  const gpay    = `tez://upi/pay?pa=${upiId}&pn=${pn}&am=${amount}&tn=${tn}&cu=INR`;
  const paytm   = `paytmmp://pay?pa=${upiId}&pn=${pn}&am=${amount}&tn=${tn}&cu=INR`;
  const bhim    = `upi://pay?pa=${upiId}&pn=${pn}&am=${amount}&tn=${tn}&cu=INR&app=bhim`;

  res.json({ upiId, amount, bookingId: booking.bookingId, upiUrl, phonepe, gpay, paytm, bhim, qrData: upiUrl });
});

app.post('/api/payment/:bookingId/confirm', async (req, res) => {
  await Booking.findOneAndUpdate({ bookingId: req.params.bookingId }, { advancePaid: true });
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
//  CHAT ROUTES (PUBLIC — no auth, identified by phone)
// ══════════════════════════════════════════════════════════════

// Customer sends a message
app.post('/api/chat/send', async (req, res) => {
  const { customerName, customerPhone, message } = req.body;
  if (!customerName || !customerPhone || !message)
    return res.status(400).json({ error: 'Missing fields' });

  const sessionId = phoneToSession(customerPhone);

  const msg = await ChatMessage.create({
    sessionId,
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    message: message.trim(),
    fromCustomer: true,
    read: false
  });

  // Notify admin via push
  await sendPushToAll(
    `💬 ${customerName}`,
    message.substring(0, 100),
    { url: '/admin', isChat: true, sessionId }
  );

  res.json({ success: true, sessionId, _id: msg._id });
});

// Customer fetches full history (initial load)
app.get('/api/chat/:phone/history', async (req, res) => {
  const sessionId = phoneToSession(req.params.phone);
  const messages = await ChatMessage.find({ sessionId }).sort({ createdAt: 1 }).limit(200);
  res.json({ messages, sessionId });
});

// Customer polls for new messages since a timestamp
app.get('/api/chat/:phone/updates', async (req, res) => {
  const sessionId = phoneToSession(req.params.phone);
  const since = req.query.since ? new Date(req.query.since) : new Date(0);
  const messages = await ChatMessage.find({
    sessionId,
    createdAt: { $gt: since }
  }).sort({ createdAt: 1 });
  res.json({ messages });
});

// ══════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ══════════════════════════════════════════════════════════════
const adminAuth = (req, res, next) => {
  if (req.session.admin) return next();
  res.redirect('/admin/login');
};

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

  // ── Chat sessions: group by sessionId, get latest message + unread count ──
  // Use two separate queries to avoid complex $cond aggregation issues
  const chatSessions = await ChatMessage.aggregate([
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$sessionId',
        customerName: { $first: '$customerName' },
        customerPhone: { $first: '$customerPhone' },
        lastMessage: { $first: '$message' },
        lastFromCustomer: { $first: '$fromCustomer' },
        lastTime: { $first: '$createdAt' },
        totalUnread: {
          $sum: {
            $cond: {
              if: { $and: [
                { $eq: ['$fromCustomer', true] },
                { $eq: ['$read', false] }
              ]},
              then: 1,
              else: 0
            }
          }
        }
      }
    },
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
    req.session.admin = true;
    res.redirect('/admin');
  } else {
    res.render('admin/login', { error: 'Invalid credentials' });
  }
});

app.get('/admin/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });

// Cars CRUD
app.post('/admin/cars/add', adminAuth, upload.single('image'), async (req, res) => {
  const { name, model, pricePerKm, fixedKm, fixedPrice, extraKmCharge, tollTax, availableIn, seats, ac, description } = req.body;
  const imagePath = req.file ? '/uploads/' + req.file.filename : '/images/default-crysta.jpg';
  await Car.create({
    name, model, image: imagePath,
    pricePerKm: Number(pricePerKm),
    fixedPackage: (fixedKm && fixedPrice) ? { km: Number(fixedKm), price: Number(fixedPrice) } : undefined,
    extraKmCharge: Number(extraKmCharge),
    tollTax: tollTax || 'As per actual',
    availableIn: availableIn ? availableIn.split(',').map(s => s.trim()) : ['Agra'],
    seats: Number(seats) || 4,
    ac: ac === 'true',
    description
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
  const update = {
    name, model,
    pricePerKm: Number(pricePerKm),
    fixedPackage: (fixedKm && fixedPrice) ? { km: Number(fixedKm), price: Number(fixedPrice) } : { km: 0, price: 0 },
    extraKmCharge: Number(extraKmCharge),
    tollTax: tollTax || 'As per actual',
    availableIn: availableIn ? availableIn.split(',').map(s => s.trim()) : ['Agra'],
    seats: Number(seats) || 4,
    ac: ac === 'true',
    description
  };
  if (req.file) update.image = '/uploads/' + req.file.filename;
  await Car.findByIdAndUpdate(req.params.id, update);
  res.redirect('/admin');
});

app.post('/admin/cars/:id/toggle', adminAuth, async (req, res) => {
  const car = await Car.findById(req.params.id);
  if (car) { car.isActive = !car.isActive; await car.save(); }
  res.json({ success: true, isActive: car ? car.isActive : false });
});

app.post('/admin/cars/:id/delete', adminAuth, async (req, res) => {
  await Car.findByIdAndDelete(req.params.id);
  res.redirect('/admin');
});

app.get('/admin/bookings', adminAuth, async (req, res) => {
  const bookings = await Booking.find().populate('car').sort({ createdAt: -1 });
  res.render('admin/bookings', { bookings });
});

app.post('/admin/bookings/:id/status', adminAuth, async (req, res) => {
  await Booking.findByIdAndUpdate(req.params.id, { status: req.body.status });
  res.redirect('/admin/bookings');
});

app.post('/admin/bookings/:id/advance', adminAuth, async (req, res) => {
  const booking = await Booking.findByIdAndUpdate(req.params.id, { advancePaid: req.body.paid === 'true' }, { new: true });
  res.json({ success: true, advancePaid: booking.advancePaid });
});

app.post('/admin/push', adminAuth, async (req, res) => {
  const { title, body } = req.body;
  await sendPushToAll(title, body);
  res.json({ success: true });
});

// ── Admin chat routes ────────────────────────────────────────

// Get all messages for a session (marks customer messages as read)
app.get('/admin/chat/:sessionId/messages', adminAuth, async (req, res) => {
  const messages = await ChatMessage.find({ sessionId: req.params.sessionId })
    .sort({ createdAt: 1 });
  // Mark unread customer messages as read
  await ChatMessage.updateMany(
    { sessionId: req.params.sessionId, fromCustomer: true, read: false },
    { $set: { read: true } }
  );
  res.json({ messages });
});

// Admin sends a reply
app.post('/admin/chat/:sessionId/reply', adminAuth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  const existing = await ChatMessage.findOne({ sessionId: req.params.sessionId });
  if (!existing) return res.status(404).json({ error: 'Session not found' });

  await ChatMessage.create({
    sessionId: req.params.sessionId,
    customerName: existing.customerName,
    customerPhone: existing.customerPhone,
    message: message.trim(),
    fromCustomer: false,
    read: true
  });

  res.json({ success: true });
});

// Admin clears chat history for a session
app.delete('/admin/chat/:sessionId', adminAuth, async (req, res) => {
  await ChatMessage.deleteMany({ sessionId: req.params.sessionId });
  res.json({ success: true });
});

// Admin polls for new messages in a session (since timestamp)
app.get('/admin/chat/:sessionId/updates', adminAuth, async (req, res) => {
  const since = req.query.since ? new Date(req.query.since) : new Date(0);
  const messages = await ChatMessage.find({
    sessionId: req.params.sessionId,
    createdAt: { $gt: since }
  }).sort({ createdAt: 1 });
  // Mark new customer messages as read
  await ChatMessage.updateMany(
    { sessionId: req.params.sessionId, fromCustomer: true, read: false },
    { $set: { read: true } }
  );
  res.json({ messages });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Brajwasi Tour & Travels running on port ${PORT}`));
