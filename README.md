# 🚗 Brajwasi Travels — Website

**Premium Car Rental Website | Agra | Est. 1980**

Full-stack Node.js + MongoDB website for Brajwasi Travels with booking system, admin panel, and push notifications.

---

## 🌐 Live Features

- **Public Website** — luxury dark-gold theme, car fleet, booking system
- **Admin Panel** — `/admin/login` (not linked from main site)
- **Push Notifications** — works even when browser is closed
- **Real-time Price Calculator** — auto-computes fare from KM
- **WhatsApp Integration** — one-click WhatsApp contact
- **Email Notifications** — on new bookings
- **PWA** — installable on mobile devices

---

## ⚙️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Database | MongoDB Atlas |
| Templating | EJS |
| Push Notifications | Web Push (VAPID) |
| File Upload | Multer |
| Email | Nodemailer |
| Deployment | Render.com |

---

## 🚀 Deployment on Render (Step-by-Step)

### Step 1: Set Up MongoDB Atlas (Free)

1. Go to [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Create a free account → Create a **free M0 cluster**
3. Click **Connect** → **Drivers** → Copy the connection string
4. Replace `<password>` with your database password
5. The URI looks like:
   ```
   mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/brajwasi_travels?retryWrites=true&w=majority
   ```
6. In **Network Access** → Add IP: `0.0.0.0/0` (allow all, needed for Render)

### Step 2: Push Code to GitHub

```bash
git init
git add .
git commit -m "Initial commit - Brajwasi Travels"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/brajwasi-travels.git
git push -u origin main
```

### Step 3: Deploy on Render

1. Go to [render.com](https://render.com) → Sign up free
2. Click **New** → **Web Service**
3. Connect your GitHub repo
4. Configure:
   - **Name:** `brajwasi-travels`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
5. Add **Environment Variables:**

| Variable | Value |
|----------|-------|
| `MONGODB_URI` | Your MongoDB Atlas connection string |
| `SESSION_SECRET` | Any random long string |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | Choose a strong password |
| `VAPID_PUBLIC_KEY` | `BOD1KM-BMJ4mGHLuNjAkVZOnYWu6fgT5Wlv-MptZsnJmzkxNT2KAI6qqxw0IBnAmZH30-wVMOPAWxPre-9C7rbE` |
| `VAPID_PRIVATE_KEY` | `OhSUztjngIPuuSwikR7_9O0AVh4JhZfLNWVMH_g3F6E` |
| `VAPID_EMAIL` | `mailto:brajwasitravels.1980@gmail.com` |
| `EMAIL_USER` | `brajwasitravels.1980@gmail.com` |
| `EMAIL_PASS` | Your Gmail App Password (see below) |

6. Click **Create Web Service** → Wait for deploy (~2-3 min)

### Step 4: Gmail App Password (for email notifications)

1. Go to your Google Account → Security
2. Enable **2-Step Verification** (if not already)
3. Search for **App Passwords**
4. Generate a password for "Mail" → Copy the 16-character password
5. Use this as `EMAIL_PASS` in Render env variables

---

## 🔐 Admin Panel

**URL:** `https://yoursite.onrender.com/admin/login`

> ⚠️ This URL is NOT linked anywhere on the main website — it's hidden.

**Default credentials (change in env variables):**
- Username: `admin`
- Password: `brajwasi@2024`

### Admin Features:
- 📊 Dashboard with stats
- ➕ Add new cars (with photo upload)
- 🚗 Manage fleet (enable/disable/delete)
- 📋 View all bookings with search & filter
- ✅ Update booking status (Pending → Confirmed → Completed)
- 📲 WhatsApp customers directly
- 🔔 Send push notifications to all users

---

## 💰 Default Pricing (Toyota Innova Crysta)

| Type | Rate |
|------|------|
| Fixed Package | ₹3,200 for 300 km |
| Extra KM | ₹12 per km |
| Per KM Rate | ₹12/km |
| Toll Tax | As per actual (paid by customer) |
| Available In | Agra |

---

## 📞 Contact Details in Website

- **Phone/WhatsApp:** 9411061000
- **Email:** brajwasitravels.1980@gmail.com

---

## 📁 Project Structure

```
brajwasi-travels/
├── server.js               # Main Express server (routes, API, admin)
├── package.json            
├── render.yaml             # Render deployment config
├── .env                    # Environment variables (don't commit!)
├── config/
│   └── db.js              # MongoDB connection + seed default Crysta
├── models/
│   └── index.js           # Car, Booking, PushSubscription schemas
├── public/
│   ├── css/main.css       # Luxury dark-gold theme CSS
│   ├── js/main.js         # Booking modal, price calc, push notifs
│   ├── sw.js              # Service Worker (background push)
│   ├── manifest.json      # PWA manifest
│   ├── images/
│   │   ├── favicon.png
│   │   └── default-crysta.jpg
│   └── uploads/           # Admin-uploaded car images
└── views/
    ├── index.ejs          # Main homepage
    └── admin/
        ├── login.ejs      # Admin login page
        ├── dashboard.ejs  # Admin dashboard (stats, add car, fleet)
        └── bookings.ejs   # Bookings management table
```

---

## 🔔 Push Notifications

Push notifications work even when the browser/app is closed:

1. **User visits website** → browser asks permission
2. **User allows** → subscription saved to MongoDB
3. **New booking comes in** → all subscribers get notified
4. **Admin sends manual push** → from admin panel → Push Notifications tab

---

## 🛠 Local Development

```bash
# Install dependencies
npm install

# Set up .env file with your MongoDB URI
# (edit .env file)

# Start server
node server.js

# Open in browser
# Main site: http://localhost:3000
# Admin: http://localhost:3000/admin/login
```

---

## ✅ Post-Deployment Checklist

- [ ] MongoDB Atlas cluster created and URI added to Render
- [ ] Admin password changed from default
- [ ] Gmail App Password set up for email notifications
- [ ] Test booking on live site
- [ ] Test admin login at `/admin/login`
- [ ] Enable push notifications from browser
- [ ] Upload a real photo of Toyota Crysta via admin panel

---

*Built for Brajwasi Travels — Agra's Most Trusted Car Rental Since 1980*
