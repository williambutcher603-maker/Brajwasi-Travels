const mongoose = require('mongoose');

// Car Model
const carSchema = new mongoose.Schema({
  name: { type: String, required: true },
  model: { type: String, required: true },
  image: { type: String, required: true },
  imagePublicId: { type: String },
  pricePerKm: { type: Number, required: true },
  fixedPackage: {
    km: { type: Number },
    price: { type: Number }
  },
  extraKmCharge: { type: Number, required: true },
  tollTax: { type: String, default: 'As per actual' },
  availableIn: [{ type: String }],
  seats: { type: Number, default: 4 },
  ac: { type: Boolean, default: true },
  description: { type: String },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// Booking Model
const bookingSchema = new mongoose.Schema({
  bookingId: { type: String, unique: true, required: true },
  car: { type: mongoose.Schema.Types.ObjectId, ref: 'Car', required: true },
  carName: { type: String },
  customerName: { type: String, required: true },
  customerPhone: { type: String, required: true },
  customerEmail: { type: String },
  pickupLocation: { type: String, required: true },
  dropLocation: { type: String, required: true },
  journeyDate: { type: Date, required: true },
  journeyTime: { type: String, required: true },
  estimatedKm: { type: Number },
  totalPrice: { type: Number },
  status: { type: String, enum: ['pending', 'confirmed', 'completed', 'cancelled'], default: 'pending' },
  notes: { type: String },
  createdAt: { type: Date, default: Date.now }
});

// Push Subscription Model
const subscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, unique: true },
  keys: {
    p256dh: String,
    auth: String
  },
  createdAt: { type: Date, default: Date.now }
});

const Car = mongoose.model('Car', carSchema);
const Booking = mongoose.model('Booking', bookingSchema);
const PushSubscription = mongoose.model('PushSubscription', subscriptionSchema);

module.exports = { Car, Booking, PushSubscription };
