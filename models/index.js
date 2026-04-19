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
  seats: { type: Number, default: 4 },
  ac: { type: Boolean, default: true },
  description: String,
  isActive: { type: Boolean, default: true },
  isAvailable: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const bookingSchema = new mongoose.Schema({
  bookingId: { type: String, unique: true, required: true },
  car: { type: mongoose.Schema.Types.ObjectId, ref: 'Car', required: true },
  carName: String,
  customerName: { type: String, required: true },
  customerPhone: { type: String, required: true },
  customerEmail: String,
  pickupLocation: { type: String, required: true },
  dropLocation: { type: String, required: true },
  journeyDate: { type: Date, required: true },
  journeyTime: { type: String, required: true },
  estimatedKm: { type: Number, default: 0 },
  totalPrice: { type: Number, default: 0 },
  advancePaid: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['pending','advance_pending','confirmed','completed','cancelled'],
    default: 'pending'
  },
  driverName: String,
  driverPhone: String,
  driverLat: Number,
  driverLng: Number,
  driverLocationUpdatedAt: Date,
  tracker24Id: String,
  statusMessage: String,
  notes: String,
  createdAt: { type: Date, default: Date.now }
});

const subscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, unique: true },
  keys: { p256dh: String, auth: String },
  createdAt: { type: Date, default: Date.now }
});

const chatSessionSchema = new mongoose.Schema({
  sessionId: { type: String, unique: true, required: true },
  customerName: { type: String, default: 'Guest' },
  customerPhone: { type: String, default: '' },
  messages: [{
    sender: { type: String, enum: ['customer','admin'], required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false }
  }],
  unreadCount: { type: Number, default: 0 },
  lastMessage: String,
  lastMessageAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = {
  Car: mongoose.model('Car', carSchema),
  Booking: mongoose.model('Booking', bookingSchema),
  PushSubscription: mongoose.model('PushSubscription', subscriptionSchema),
  ChatSession: mongoose.model('ChatSession', chatSessionSchema)
};
