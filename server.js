require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const webpush = require('web-push');
const connectDB = require('./config/db');
const { Car, Booking, PushSubscription, ChatSession } = require('./models');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const nodemailer = require('nodemailer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// VAPID
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

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'brajwasi_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});
if (!fs.existsSync('public/uploads')) fs.mkdirSync('public/uploads', { recursive: true });

// Email helper
const sendEmail = async (subject, html) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  try {
    const t = nodemailer.createTransporter({ service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
    await t.sendMail({ from: process.env.EMAIL_USER,
      to: 'brajwasitravels.1980@gmail.com', subject, html });
  } catch(e) { console.log('Email error:', e.message); }
};

// Push helper
const sendPushToAll = async (title, body, data = {}) => {
  const subs = await PushSubscription.find();
  const payload = JSON.stringify({ title, body, ...data });
  await Promise.allSettled(subs.map(sub =>
    webpush.sendNotification(sub, payload).catch(async err => {
      if (err.statusCode === 410) await PushSubscription.deleteOne({ endpoint: sub.endpoint });
    })
  ));
};

// ========== SOCKET.IO CHAT ==========
const adminSockets = new Set();

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

io.on('connection', (socket) => {
  const session = socket.request.session;

  // Admin joins
  if (session && session.admin) {
    adminSockets.add(socket.id);
    socket.join('admin-room');
    socket.on('disconnect', () => adminSockets.delete(socket.id));

    // Admin sends message to a session
    socket.on('admin-message', async ({ sessionId, text }) => {
      const chat = await ChatSession.findOne({ sessionId });
      if (!chat) return;
      chat.messages.push({ sender: 'admin', text, timestamp: new Date(), read: true });
      chat.lastMessage = text;
      chat.lastMessageAt = new Date();
      await chat.save();
      io.to(sessionId).emit('new-message', { sender: 'admin', text, timestamp: new Date() });
      io.to('admin-room').emit('chat-updated', { sessionId, text, senderName: 'Admin' });
    });

    // Admin reads a chat
    socket.on('admin-read', async ({ sessionId }) => {
      await ChatSession.updateOne({ sessionId }, { unreadCount: 0, $set: { 'messages.$[].read': true } });
      io.to('admin-room').emit('chat-read', { sessionId });
    });

    return;
  }

  // Customer joins their session room
  const sessionId = socket.handshake.query.sessionId;
  if (sessionId) {
    socket.join(sessionId);

    socket.on('customer-message', async ({ sessionId, text, customerName, customerPhone }) => {
      let chat = await ChatSession.findOne({ sessionId });
      if (!chat) {
        chat = await ChatSession.create({
          sessionId, customerName: customerName || 'Guest',
          customerPhone: customerPhone || '', messages: [], unreadCount: 0
        });
      }
      chat.messages.push({ sender: 'customer', text, timestamp: new Date(), read: false });
      chat.unreadCount = (chat.unreadCount || 0) + 1;
      chat.lastMessage = text;
      chat.lastMessageAt = new Date();
      chat.customerName = customerName || chat.customerName;
      chat.customerPhone = customerPhone || chat.customerPhone;
      await chat.save();

      // Emit to admin room
      io.to('admin-room').emit('new-chat-message', {
        sessionId, text, senderName: chat.customerName,
        phone: chat.customerPhone, timestamp: new Date(),
        unreadCount: chat.unreadCount
      });

      // Push notification to admin
      await sendPushToAll(
        `💬 New Chat - ${chat.customerName}`,
        text.substring(0, 80),
        { url: '/admin/chat', sessionId }
      );
    });
  }
});

// ========== PUBLIC ROUTES ==========

app.get('/', async (req, res) => {
  const cars = await Car.find({ isActive: true });
  res.render('index', { cars });
});

app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

app.post('/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body;
  await PushSubscription.findOneAndUpdate({ endpoint }, { endpoint, keys }, { upsert: true, new: true });
  res.json({ success: true });
});

// Book a car
app.post('/api/book', async (req, res) => {
  const { carId, customerName, customerPhone, customerEmail,
    pickupLocation, dropLocation, journeyDate, journeyTime, estimatedKm, notes } = req.body;

  if (!carId || !customerName || !customerPhone || !pickupLocation || !dropLocation || !journeyDate || !journeyTime) {
    return res.status(400).json({ error: 'All required fields must be filled' });
  }

  const car = await Car.findById(carId);
  if (!car) return res.status(404).json({ error: 'Car not found' });

  const km = parseInt(estimatedKm) || 0;
  let totalPrice = 0;
  if (km > 0) {
    if (car.fixedPackage && car.fixedPackage.km && km <= car.fixedPackage.km) {
      totalPrice = car.fixedPackage.price;
    } else if (car.fixedPackage && car.fixedPackage.km) {
      totalPrice = car.fixedPackage.price + ((km - car.fixedPackage.km) * car.extraKmCharge);
    } else {
      totalPrice = km * car.pricePerKm;
    }
  }

  const booking = await Booking.create({
    bookingId: 'BT-' + uuidv4().split('-')[0].toUpperCase(),
    car: carId, carName: car.name + ' ' + car.model,
    customerName, customerPhone, customerEmail,
    pickupLocation, dropLocation,
    journeyDate: new Date(journeyDate), journeyTime,
    estimatedKm: km, totalPrice, notes, status: 'advance_pending'
  });

  await sendPushToAll(
    '🚗 New Booking – Brajwasi Travels',
    `${customerName} booked ${car.model} | ${pickupLocation} → ${dropLocation}`,
    { url: '/admin/bookings', bookingId: booking.bookingId }
  );

  await sendEmail(
    `New Booking ${booking.bookingId} – ${customerName}`,
    `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;padding:24px;border-radius:12px">
      <h2 style="color:#C9922A">🚗 New Booking Received</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px;font-weight:bold;width:40%">Booking ID</td><td style="padding:8px;color:#C9922A;font-weight:bold">${booking.bookingId}</td></tr>
        <tr style="background:#fff"><td style="padding:8px;font-weight:bold">Customer</td><td style="padding:8px">${customerName}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">Phone</td><td style="padding:8px">${customerPhone}</td></tr>
        <tr style="background:#fff"><td style="padding:8px;font-weight:bold">Car</td><td style="padding:8px">${car.name} ${car.model}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">From</td><td style="padding:8px">${pickupLocation}</td></tr>
        <tr style="background:#fff"><td style="padding:8px;font-weight:bold">To</td><td style="padding:8px">${dropLocation}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">Date & Time</td><td style="padding:8px">${new Date(journeyDate).toLocaleDateString('en-IN')} at ${journeyTime}</td></tr>
        <tr style="background:#fff"><td style="padding:8px;font-weight:bold">Est. KM</td><td style="padding:8px">${km || 'Not specified'}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">Est. Price</td><td style="padding:8px;color:green;font-weight:bold">₹${totalPrice || 'TBD'}</td></tr>
        <tr style="background:#fff"><td style="padding:8px;font-weight:bold">Status</td><td style="padding:8px;color:orange">Advance Payment Pending</td></tr>
      </table>
      <p style="margin-top:16px;color:#666">Advance ₹500 expected via UPI: <strong>MRBRAJWASITRAVELS.eazypay@icici</strong></p>
      <a href="${process.env.BASE_URL || 'https://brajwasi-travels.onrender.com'}/admin/bookings" style="display:inline-block;margin-top:12px;background:#C9922A;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">View in Admin Panel</a>
    </div>`
  );

  res.json({ success: true, bookingId: booking.bookingId, totalPrice });
});

// ========== ADMIN ROUTES ==========
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
    pendingBookings: await Booking.countDocuments({ status: { $in: ['pending','advance_pending'] } }),
    confirmedBookings: await Booking.countDocuments({ status: 'confirmed' })
  };
  res.render('admin/dashboard', { cars, bookings, stats });
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
    ac: ac === 'true', description
  });
  res.redirect('/admin');
});

// Edit car GET
app.get('/admin/cars/:id/edit', adminAuth, async (req, res) => {
  const car = await Car.findById(req.params.id);
  if (!car) return res.redirect('/admin');
  res.render('admin/edit-car', { car });
});

// Edit car POST
app.post('/admin/cars/:id/edit', adminAuth, upload.single('image'), async (req, res) => {
  const { name, model, pricePerKm, fixedKm, fixedPrice, extraKmCharge, tollTax, availableIn, seats, ac, description } = req.body;
  const updates = {
    name, model,
    pricePerKm: Number(pricePerKm),
    fixedPackage: fixedKm && fixedPrice ? { km: Number(fixedKm), price: Number(fixedPrice) } : undefined,
    extraKmCharge: Number(extraKmCharge),
    tollTax: tollTax || 'As per actual',
    availableIn: availableIn ? availableIn.split(',').map(s => s.trim()) : ['Agra'],
    seats: Number(seats) || 4,
    ac: ac === 'true', description
  };
  if (req.file) updates.image = '/uploads/' + req.file.filename;
  await Car.findByIdAndUpdate(req.params.id, updates);
  res.redirect('/admin');
});

// Toggle isActive
app.post('/admin/cars/:id/toggle', adminAuth, async (req, res) => {
  const car = await Car.findById(req.params.id);
  if (car) { car.isActive = !car.isActive; await car.save(); }
  res.redirect('/admin');
});

// Toggle availability (on/off for booking)
app.post('/admin/cars/:id/availability', adminAuth, async (req, res) => {
  const car = await Car.findById(req.params.id);
  if (car) { car.isAvailable = !car.isAvailable; await car.save(); }
  res.json({ success: true, isAvailable: car.isAvailable });
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
  await Booking.findByIdAndUpdate(req.params.id, { advancePaid: true, status: 'confirmed' });
  res.redirect('/admin/bookings');
});

// Push notification
app.post('/admin/push', adminAuth, async (req, res) => {
  await sendPushToAll(req.body.title, req.body.body);
  res.json({ success: true });
});

// Chat admin page
app.get('/admin/chat', adminAuth, async (req, res) => {
  const chats = await ChatSession.find().sort({ lastMessageAt: -1 });
  res.render('admin/chat', { chats });
});

// Get single chat messages
app.get('/admin/chat/:sessionId', adminAuth, async (req, res) => {
  const chat = await ChatSession.findOne({ sessionId: req.params.sessionId });
  if (!chat) return res.json({ messages: [] });
  await ChatSession.updateOne({ sessionId: req.params.sessionId }, { unreadCount: 0 });
  res.json({ chat });
});

// Google Search Console verification (static file)
app.get('/google:code.html', (req, res) => {
  res.send(`google-site-verification: google${req.params.code}.html`);
});

// ========== START ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Brajwasi Travels on port ${PORT}`));

// Chat list API (admin)
app.get('/admin/chat/list', adminAuth, async (req, res) => {
  const chats = await ChatSession.find().sort({ lastMessageAt: -1 }).lean();
  res.json({ chats });
});
