const mongoose = require('mongoose');

const carSchema = new mongoose.Schema({
  name: { type: String, required: true },
  model: { type: String, required: true },
  image: { type: String, required: true },
  pricePerKm: { type: Number, required: true },
  fixedPackage: { km: Number, price: Number },
  extraKmCharge: { type: Number, required: true },
  tollTax: { type: String, default: 'As per actual' },
  availableIn: [String],
  seats: { type: Number, default: 7 },
  ac: { type: Boolean, default: true },
  description: String,
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const bookingSchema = new mongoose.Schema({
  bookingId: { type: String, unique: true, required: true },
  car: { type: mongoose.Schema.Types.ObjectId, ref: 'Car' },
  carName: String,
  customerName: { type: String, required: true },
  customerPhone: { type: String, required: true },
  customerEmail: String,
  pickupLocation: { type: String, required: true },
  dropLocation: { type: String, required: true },
  journeyDate: { type: Date, required: true },
  journeyTime: String,
  estimatedKm: Number,
  totalPrice: Number,
  status: { type: String, enum: ['pending','confirmed','completed','cancelled'], default: 'pending' },
  advancePaid: { type: Boolean, default: false },
  driverLat: Number,
  driverLng: Number,
  driverLastSeen: Date,
  notes: String,
  createdAt: { type: Date, default: Date.now }
});

const subscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, unique: true },
  keys: { p256dh: String, auth: String },
  createdAt: { type: Date, default: Date.now }
});

const chatMessageSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  customerName: { type: String, required: true },
  customerPhone: { type: String, required: true },
  message: { type: String, required: true },
  fromCustomer: { type: Boolean, default: true },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const Car = mongoose.model('Car', carSchema);
const Booking = mongoose.model('Booking', bookingSchema);
const PushSubscription = mongoose.model('PushSubscription', subscriptionSchema);
const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);

module.exports = { Car, Booking, PushSubscription, ChatMessage };
