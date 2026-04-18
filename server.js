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
const nodemailer = require('nodemailer');
const crypto = require('crypto');

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
    const transporter = nodemailer.createTransporter({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: 'brajwasitravels.1980@gmail.com',
      subject,
      html
    });
  } catch (e) { console.log('Email failed:', e.message); }
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
  res.json({
    pricePerKm: car.pricePerKm,
    fixedPackage: car.fixedPackage,
    extraKmCharge: car.extraKmCharge,
    tollTax: car.tollTax
  });
});

app.post('/api/book', async (req, res) => {
  const { carId, customerName, customerPhone, customerEmail, pickupLocation, dropLocation, journeyDate, journeyTime, estimatedKm, notes } = req.body;
  
  const car = await Car.findById(carId);
  if (!car) return res.status(404).json({ error: 'Car not found' });

  let totalPrice = 0;
  if (estimatedKm) {
    if (car.fixedPackage && car.fixedPackage.km && Number(estimatedKm) <= car.fixedPackage.km) {
      totalPrice = car.fixedPackage.price;
    } else if (car.fixedPackage && car.fixedPackage.km) {
      const extraKm = Number(estimatedKm) - car.fixedPackage.km;
      totalPrice = car.fixedPackage.price + (extraKm * car.extraKmCharge);
    } else {
      totalPrice = Number(estimatedKm) * car.pricePerKm;
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

  await sendPushToAll(
    '🚗 New Booking - Brajwasi Travels',
    `${customerName} booked ${car.model} | ${pickupLocation} → ${dropLocation}`,
    { bookingId: booking.bookingId, url: '/admin/bookings' }
  );

  await sendEmail(
    `🚗 New Booking ${bookingId} - ${customerName}`,
    `<div style="font-family:Arial,sans-serif;max-width:600px;padding:20px">
      <h2 style="color:#C9922A;border-bottom:2px solid #C9922A;padding-bottom:10px">🚗 New Booking - Brajwasi Travels</h2>
      <table style="width:100%;border-collapse:collapse;margin-top:15px">
        <tr style="background:#f9f9f9"><td style="padding:10px;border:1px solid #ddd;font-weight:bold">Booking ID</td><td style="padding:10px;border:1px solid #ddd;color:#C9922A;font-weight:bold">${bookingId}</td></tr>
        <tr><td style="padding:10px;border:1px solid #ddd;font-weight:bold">Customer Name</td><td style="padding:10px;border:1px solid #ddd">${customerName}</td></tr>
        <tr style="background:#f9f9f9"><td style="padding:10px;border:1px solid #ddd;font-weight:bold">Phone</td><td style="padding:10px;border:1px solid #ddd">${customerPhone}</td></tr>
        <tr><td style="padding:10px;border:1px solid #ddd;font-weight:bold">Email</td><td style="padding:10px;border:1px solid #ddd">${customerEmail || 'N/A'}</td></tr>
        <tr style="background:#f9f9f9"><td style="padding:10px;border:1px solid #ddd;font-weight:bold">Car</td><td style="padding:10px;border:1px solid #ddd">${car.name} ${car.model}</td></tr>
        <tr><td style="padding:10px;border:1px solid #ddd;font-weight:bold">Pickup</td><td style="padding:10px;border:1px solid #ddd">${pickupLocation}</td></tr>
        <tr style="background:#f9f9f9"><td style="padding:10px;border:1px solid #ddd;font-weight:bold">Drop</td><td style="padding:10px;border:1px solid #ddd">${dropLocation}</td></tr>
        <tr><td style="padding:10px;border:1px solid #ddd;font-weight:bold">Date &amp; Time</td><td style="padding:10px;border:1px solid #ddd">${journeyDate} at ${journeyTime}</td></tr>
        <tr style="background:#f9f9f9"><td style="padding:10px;border:1px solid #ddd;font-weight:bold">Estimated KM</td><td style="padding:10px;border:1px solid #ddd">${estimatedKm || 'Not specified'} km</td></tr>
        <tr><td style="padding:10px;border:1px solid #ddd;font-weight:bold">Estimated Fare</td><td style="padding:10px;border:1px solid #ddd;color:green;font-weight:bold">₹${totalPrice}</td></tr>
        <tr style="background:#f9f9f9"><td style="padding:10px;border:1px solid #ddd;font-weight:bold">Notes</td><td style="padding:10px;border:1px solid #ddd">${notes || 'None'}</td></tr>
      </table>
      <div style="margin-top:20px;padding:15px;background:#fff8e6;border-left:4px solid #C9922A;border-radius:4px">
        <p style="margin:0;color:#C9922A;font-weight:bold">⚠️ Advance Payment Expected</p>
        <p style="margin:8px 0 0">Customer should pay ₹500 advance via UPI: <strong>MRBRAJWASITRAVELS.eazypay@icici</strong></p>
        <p style="margin:5px 0 0;font-size:13px;color:#666">This advance is fully refundable if car does not arrive or booking is cancelled before arrival.</p>
      </div>
    </div>`
  );

  res.json({ success: true, bookingId: booking.bookingId, totalPrice });
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
    `💬 Chat: ${customerName}`,
    message.substring(0, 100),
    { url: '/admin' }
  );

  await sendEmail(
    `💬 New Chat from ${customerName} (${customerPhone})`,
    `<div style="font-family:Arial;max-width:500px;padding:20px">
      <h3 style="color:#C9922A">💬 New Customer Chat Message</h3>
      <p><strong>From:</strong> ${customerName}</p>
      <p><strong>Phone:</strong> ${customerPhone}</p>
      <p><strong>Message:</strong></p>
      <div style="background:#f5f5f5;padding:12px;border-radius:6px;border-left:3px solid #C9922A">${message}</div>
      <p style="margin-top:15px"><a href="/admin" style="color:#C9922A">Reply in Admin Panel →</a></p>
    </div>`
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

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

app.post('/admin/cars/add', adminAuth, upload.single('image'), async (req, res) => {
  const { name, model, pricePerKm, fixedKm, fixedPrice, extraKmCharge, tollTax, availableIn, seats, ac, description } = req.body;
  const imagePath = req.file ? '/uploads/' + req.file.filename : '/images/default-crysta.jpg';
  await Car.create({
    name, model,
    image: imagePath,
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

// Edit car - show form
app.get('/admin/cars/:id/edit', adminAuth, async (req, res) => {
  const car = await Car.findById(req.params.id);
  if (!car) return res.redirect('/admin');
  res.render('admin/edit-car', { car });
});

// Edit car - save
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

// Admin chat - get messages for a session
app.get('/admin/chat/:sessionId/messages', adminAuth, async (req, res) => {
  const messages = await ChatMessage.find({ sessionId: req.params.sessionId }).sort({ createdAt: 1 });
  await ChatMessage.updateMany({ sessionId: req.params.sessionId, fromCustomer: true }, { read: true });
  res.json({ messages });
});

// Admin reply to chat
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Brajwasi Travels running on port ${PORT}`));
