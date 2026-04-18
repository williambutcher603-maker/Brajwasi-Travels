const mongoose = require('mongoose');
const { Car } = require('../models');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');
    await seedDefaultCar();
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
};

const seedDefaultCar = async () => {
  const count = await Car.countDocuments();
  if (count === 0) {
    await Car.create({
      name: 'Toyota Crysta',
      model: 'Innova Crysta',
      image: '/images/default-crysta.jpg',
      pricePerKm: 12,
      fixedPackage: { km: 300, price: 3200 },
      extraKmCharge: 12,
      tollTax: 'As per actual (paid by customer)',
      availableIn: ['Agra'],
      seats: 7,
      ac: true,
      description: 'Premium 7-seater MPV, perfect for family tours and corporate travel. Comfortable, spacious, and reliable for Agra city tours and outstation trips.',
      isActive: true
    });
    console.log('🚗 Default Crysta car seeded');
  }
};

module.exports = connectDB;
