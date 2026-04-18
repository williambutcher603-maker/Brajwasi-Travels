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

webpush.setVapidDetails(
  process.env.VAPID_EMAIL || 'mailto:brajwasitravels.1980@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

connectDB();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'brajwasi_secret',
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

const sendPushToAll = async (title, body, data = {}) => {
  const subs = await PushSubscription.find();
  const payload = JSON.stringify({ title, body, ...data });
  await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(sub, payload).catch(async (err) => {
        if (err.statusCode === 410) await PushSubscription.deleteOne({ endpoint: sub.endpoint });
      })
    )
  );
};

const sendEmail = async (subject, html) => {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    await transporter.sendMail({
      from: `"Brajwasi Tour & Travels" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER || 'brajwasitravels.1980@gmail.com',
      subject,
      html
    });
  } catch (e) { console.log('Email error (non-critical):', e.message); }
};


// ====== PUBLIC ROUTES ======

app.get('/', async (req, res) => {
  const cars = await Car.find({ isActive: true });
  res.render('index', { cars });
});

app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
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

// Book a car
app.post('/api/book', async (req, res) => {
  const { carId, customerName, customerPhone, customerEmail, pickupLocation, dropLocation, journeyDate, journeyTime, estimatedKm, notes } = req.body;

  const car = await Car.findById(carId);
  if (!car) return res.status(404).json({ error: 'Car not found' });

  let totalPrice = 0;
  if (estimatedKm) {
    const km = Number(estimatedKm);
    if (car.fixedPackage && car.fixedPackage.km && km <= car.fixedPackage.km) {
      totalPrice = car.fixedPackage.price;
    } else if (car.fixedPackage && car.fixedPackage.km) {
      totalPrice = car.fixedPackage.price + ((km - car.fixedPackage.km) * car.extraKmCharge);
    } else {
      totalPrice = km * car.pricePerKm;
    }
  }

  const bookingId = 'BT-' + uuidv4().split('-')[0].toUpperCase();

  const booking = await Booking.create({
    bookingId,
    car: carId,
    carName: car.name + ' ' + car.model,
    customerName,
    customerPhone,
    customerEmail,
    pickupLocation,
    dropLocation,
    journeyDate: new Date(journeyDate),
    journeyTime,
    estimatedKm: estimatedKm || 0,
    totalPrice,
    notes,
    status: 'pending',
    advancePaid: false
  });

  // Push notification only – no email
  await sendPushToAll(
    '🚗 New Booking!',
    `${customerName} · ${car.model} · ${pickupLocation} → ${dropLocation}`,
    { url: '/admin/bookings', bookingId }
  );
  await sendEmail(
    `🚗 New Booking ${bookingId} – ${customerName}`,
    `<div style="font-family:Arial,sans-serif;max-width:600px;padding:24px;background:#fff">
      <div style="background:linear-gradient(135deg,#B8780A,#8A5A06);padding:20px 24px;border-radius:12px 12px 0 0;margin-bottom:0">
        <h2 style="color:#fff;margin:0;font-size:20px">🚗 New Booking Received</h2>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px">Brajwasi Tour & Travels – Admin Notification</p>
      </div>
      <div style="border:1px solid #e8ddd0;border-top:none;border-radius:0 0 12px 12px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <tr style="background:#fff8ec"><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3;font-weight:700;width:40%;color:#1a1208">Booking ID</td><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3;color:#B8780A;font-weight:800;font-size:16px;letter-spacing:1px">${bookingId}</td></tr>
          <tr><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3;font-weight:600;color:#7a6a55">Customer</td><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3">${customerName}</td></tr>
          <tr style="background:#fff8ec"><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3;font-weight:600;color:#7a6a55">Phone</td><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3">${customerPhone}</td></tr>
          <tr><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3;font-weight:600;color:#7a6a55">Email</td><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3">${customerEmail || 'Not provided'}</td></tr>
          <tr style="background:#fff8ec"><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3;font-weight:600;color:#7a6a55">Car</td><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3">${car.name} ${car.model}</td></tr>
          <tr><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3;font-weight:600;color:#7a6a55">Pickup</td><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3">${pickupLocation}</td></tr>
          <tr style="background:#fff8ec"><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3;font-weight:600;color:#7a6a55">Drop</td><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3">${dropLocation}</td></tr>
          <tr><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3;font-weight:600;color:#7a6a55">Date &amp; Time</td><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3">${journeyDate} at ${journeyTime}</td></tr>
          <tr style="background:#fff8ec"><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3;font-weight:600;color:#7a6a55">Est. KM</td><td style="padding:12px 16px;border-bottom:1px solid #f0ebe3">${estimatedKm || 'Not specified'} km</td></tr>
          <tr><td style="padding:12px 16px;font-weight:600;color:#7a6a55">Est. Fare</td><td style="padding:12px 16px;color:#1A7A3A;font-weight:800;font-size:16px">₹${totalPrice.toLocaleString('en-IN')}</td></tr>
        </table>
        <div style="padding:16px;background:#fff8ec;border-top:1px solid #e8ddd0">
          <p style="margin:0;color:#7a6a55;font-size:13px">📝 Notes: ${notes || 'None'}</p>
        </div>
        <div style="padding:16px;background:#B8780A;text-align:center">
          <p style="color:#fff;margin:0;font-size:13px">Login to admin panel to manage this booking</p>
        </div>
      </div>
    </div>`
  );

  res.json({ success: true, bookingId: booking.bookingId, totalPrice });
});

// ====== UPI PAYMENT DEEP LINK ======
// Returns UPI intent URL for mobile and UPI QR data for desktop
app.get('/api/payment/:bookingId', async (req, res) => {
  const booking = await Booking.findOne({ bookingId: req.params.bookingId });
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  const upiId = process.env.UPI_ID || 'MRBRAJWASITRAVELS.eazypay@icici';
  const amount = '500.00';
  const name = encodeURIComponent('Brajwasi Tour & Travels');
  const note = encodeURIComponent('Advance for booking ' + booking.bookingId);
  const tn = encodeURIComponent('Advance booking ' + booking.bookingId);

  // Standard UPI deep link (works with PhonePe, GPay, Paytm, etc.)
  const upiUrl = `upi://pay?pa=${upiId}&pn=${name}&am=${amount}&tn=${tn}&cu=INR`;

  // App-specific intents
  const phonepe = `phonepe://pay?pa=${upiId}&pn=${name}&am=${amount}&tn=${tn}&cu=INR`;
  const gpay = `tez://upi/pay?pa=${upiId}&pn=${name}&am=${amount}&tn=${tn}&cu=INR`;
  const paytm = `paytmmp://pay?pa=${upiId}&pn=${name}&am=${amount}&tn=${tn}&cu=INR`;

  res.json({
    upiId,
    amount,
    bookingId: booking.bookingId,
    upiUrl,
    phonepe,
    gpay,
    paytm,
    // QR data is just the UPI URL – frontend will render QR from it
    qrData: upiUrl
  });
});

// Mark advance paid by customer (called after payment redirect back)
app.post('/api/payment/:bookingId/confirm', async (req, res) => {
  // Customer self-reports – admin will verify
  await Booking.findOneAndUpdate({ bookingId: req.params.bookingId }, { advancePaid: true });
  res.json({ success: true });
});

// ====== CHAT ROUTES (PUBLIC) ======

app.post('/api/chat/send', async (req, res) => {
  const { customerName, customerPhone, message } = req.body;
  if (!customerName || !customerPhone || !message) return res.status(400).json({ error: 'Missing fields' });

  const sessionId = crypto.createHash('md5').update(customerPhone.trim()).digest('hex');

  await ChatMessage.create({
    sessionId,
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    message: message.trim(),
    fromCustomer: true,
    read: false
  });

  await sendPushToAll(
    `💬 ${customerName}`,
    message.substring(0, 100),
    { url: '/admin', isChat: true, sessionId }
  );

  res.json({ success: true, sessionId });
});

app.get('/api/chat/:phone/history', async (req, res) => {
  const sessionId = crypto.createHash('md5').update(req.params.phone.trim()).digest('hex');
  const messages = await ChatMessage.find({ sessionId }).sort({ createdAt: 1 }).limit(100);
  res.json({ messages, sessionId });
});

app.get('/api/chat/:phone/updates', async (req, res) => {
  const sessionId = crypto.createHash('md5').update(req.params.phone.trim()).digest('hex');
  const since = req.query.since ? new Date(req.query.since) : new Date(0);
  const messages = await ChatMessage.find({ sessionId, createdAt: { $gt: since } }).sort({ createdAt: 1 });
  res.json({ messages });
});

// ====== ADMIN ROUTES ======

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
  const chatSessions = await ChatMessage.aggregate([
    { $sort: { createdAt: -1 } },
    { $group: {
      _id: '$sessionId',
      customerName: { $first: '$customerName' },
      customerPhone: { $first: '$customerPhone' },
      lastMessage: { $first: '$message' },
      lastTime: { $first: '$createdAt' },
      unreadCount: { $sum: { $cond: [{ $and: [{ $eq: ['$fromCustomer', true] }, { $eq: ['$read', false] }] }, 1, 0] } }
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
    req.session.admin = true;
    res.redirect('/admin');
  } else {
    res.render('admin/login', { error: 'Invalid credentials' });
  }
});

app.get('/admin/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });

// Add car
app.post('/admin/cars/add', adminAuth, upload.single('image'), async (req, res) => {
  const { name, model, pricePerKm, fixedKm, fixedPrice, extraKmCharge, tollTax, availableIn, seats, ac, description } = req.body;
  const imagePath = req.file ? '/uploads/' + req.file.filename : '/images/default-crysta.jpg';
  await Car.create({
    name, model, image: imagePath,
    pricePerKm: Number(pricePerKm),
    fixedPackage: fixedKm && fixedPrice ? { km: Number(fixedKm), price: Number(fixedPrice) } : undefined,
    extraKmCharge: Number(extraKmCharge),
    tollTax: tollTax || 'As per actual',
    availableIn: availableIn ? availableIn.split(',').map(s => s.trim()) : ['Agra'],
    seats: Number(seats) || 4,
    ac: ac === 'true',
    description
  });
  res.redirect('/admin');
});

// Edit car
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
    fixedPackage: fixedKm && fixedPrice ? { km: Number(fixedKm), price: Number(fixedPrice) } : { km: 0, price: 0 },
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

// Toggle car
app.post('/admin/cars/:id/toggle', adminAuth, async (req, res) => {
  const car = await Car.findById(req.params.id);
  if (car) { car.isActive = !car.isActive; await car.save(); }
  res.json({ success: true, isActive: car ? car.isActive : false });
});

// Delete car
app.post('/admin/cars/:id/delete', adminAuth, async (req, res) => {
  await Car.findByIdAndDelete(req.params.id);
  res.redirect('/admin');
});

// Bookings
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

// Push notification
app.post('/admin/push', adminAuth, async (req, res) => {
  const { title, body } = req.body;
  await sendPushToAll(title, body);
  res.json({ success: true });
});

// ====== ADMIN CHAT ROUTES ======

app.get('/admin/chat/:sessionId/messages', adminAuth, async (req, res) => {
  const messages = await ChatMessage.find({ sessionId: req.params.sessionId }).sort({ createdAt: 1 });
  await ChatMessage.updateMany({ sessionId: req.params.sessionId, fromCustomer: true }, { read: true });
  res.json({ messages });
});

app.post('/admin/chat/:sessionId/reply', adminAuth, async (req, res) => {
  const { message } = req.body;
  const existing = await ChatMessage.findOne({ sessionId: req.params.sessionId });
  if (!existing) return res.status(404).json({ error: 'Session not found' });
  await ChatMessage.create({
    sessionId: req.params.sessionId,
    customerName: existing.customerName,
    customerPhone: existing.customerPhone,
    message,
    fromCustomer: false,
    read: true
  });
  res.json({ success: true });
});

// Admin clear chat history for a session
app.delete('/admin/chat/:sessionId', adminAuth, async (req, res) => {
  await ChatMessage.deleteMany({ sessionId: req.params.sessionId });
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Brajwasi Tour & Travels running on port ${PORT}`));
