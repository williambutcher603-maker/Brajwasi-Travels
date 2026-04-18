require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const webpush = require('web-push');
const connectDB = require('./config/db');
const { Car, Booking, PushSubscription } = require('./models');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const nodemailer = require('nodemailer');

const app = express();

// Configure web push
webpush.setVapidDetails(
  process.env.VAPID_EMAIL || 'mailto:brajwasitravels.1980@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Connect to MongoDB
connectDB();

// Middleware
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

// Multer for image upload (local storage fallback)
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

// Ensure uploads dir exists
const fs = require('fs');
if (!fs.existsSync('public/uploads')) fs.mkdirSync('public/uploads', { recursive: true });

// Helper: send push notifications to all subscribers
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

// ============ PUBLIC ROUTES ============

// Home page
app.get('/', async (req, res) => {
  const cars = await Car.find({ isActive: true });
  res.render('index', { cars });
});

// Get VAPID public key
app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// Subscribe to push notifications
app.post('/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body;
  await PushSubscription.findOneAndUpdate(
    { endpoint },
    { endpoint, keys },
    { upsert: true, new: true }
  );
  res.json({ success: true });
});

// Get car pricing info
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

// Book a car
app.post('/api/book', async (req, res) => {
  const { carId, customerName, customerPhone, customerEmail, pickupLocation, dropLocation, journeyDate, journeyTime, estimatedKm, notes } = req.body;
  
  const car = await Car.findById(carId);
  if (!car) return res.status(404).json({ error: 'Car not found' });

  let totalPrice = 0;
  if (estimatedKm) {
    if (car.fixedPackage && estimatedKm <= car.fixedPackage.km) {
      totalPrice = car.fixedPackage.price;
    } else if (car.fixedPackage) {
      const extraKm = estimatedKm - car.fixedPackage.km;
      totalPrice = car.fixedPackage.price + (extraKm * car.extraKmCharge);
    } else {
      totalPrice = estimatedKm * car.pricePerKm;
    }
  }

  const booking = await Booking.create({
    bookingId: 'BT-' + uuidv4().split('-')[0].toUpperCase(),
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
    status: 'pending'
  });

  // Send push notification to admin/subscribers
  await sendPushToAll(
    '🚗 New Booking - Brajwasi Travels',
    `${customerName} booked ${car.model} for ${pickupLocation} → ${dropLocation}`,
    { bookingId: booking.bookingId, url: '/admin/bookings' }
  );

  // Send email notification (non-blocking)
  try {
    const transporter = nodemailer.createTransporter({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: 'brajwasitravels.1980@gmail.com',
      subject: `New Booking ${booking.bookingId} - ${customerName}`,
      html: `
        <h2>New Car Booking</h2>
        <p><b>Booking ID:</b> ${booking.bookingId}</p>
        <p><b>Customer:</b> ${customerName}</p>
        <p><b>Phone:</b> ${customerPhone}</p>
        <p><b>Car:</b> ${car.model}</p>
        <p><b>From:</b> ${pickupLocation}</p>
        <p><b>To:</b> ${dropLocation}</p>
        <p><b>Date:</b> ${journeyDate} at ${journeyTime}</p>
        <p><b>Estimated KM:</b> ${estimatedKm || 'Not specified'}</p>
        <p><b>Estimated Price:</b> ₹${totalPrice}</p>
      `
    });
  } catch (e) { /* email optional */ }

  res.json({ success: true, bookingId: booking.bookingId, totalPrice });
});

// ============ ADMIN ROUTES ============

const adminAuth = (req, res, next) => {
  if (req.session.admin) return next();
  res.redirect('/admin/login');
};

app.get('/admin', adminAuth, async (req, res) => {
  const [cars, bookings] = await Promise.all([
    Car.find().sort({ createdAt: -1 }),
    Booking.find().populate('car').sort({ createdAt: -1 }).limit(10)
  ]);
  const stats = {
    totalCars: await Car.countDocuments({ isActive: true }),
    totalBookings: await Booking.countDocuments(),
    pendingBookings: await Booking.countDocuments({ status: 'pending' }),
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

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// Add car
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

// Toggle car status
app.post('/admin/cars/:id/toggle', adminAuth, async (req, res) => {
  const car = await Car.findById(req.params.id);
  if (car) { car.isActive = !car.isActive; await car.save(); }
  res.redirect('/admin');
});

// Delete car
app.post('/admin/cars/:id/delete', adminAuth, async (req, res) => {
  await Car.findByIdAndDelete(req.params.id);
  res.redirect('/admin');
});

// Bookings management
app.get('/admin/bookings', adminAuth, async (req, res) => {
  const bookings = await Booking.find().populate('car').sort({ createdAt: -1 });
  res.render('admin/bookings', { bookings });
});

app.post('/admin/bookings/:id/status', adminAuth, async (req, res) => {
  await Booking.findByIdAndUpdate(req.params.id, { status: req.body.status });
  res.redirect('/admin/bookings');
});

// Send push notification (admin)
app.post('/admin/push', adminAuth, async (req, res) => {
  const { title, body } = req.body;
  await sendPushToAll(title, body);
  res.json({ success: true });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Brajwasi Travels running on port ${PORT}`));
