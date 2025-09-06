const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Initialize Stripe with retry
let stripe;
async function initializeStripe() {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY not found in environment variables');
    }
    if (process.env.NODE_ENV !== 'production' && !process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
      throw new Error('STRIPE_SECRET_KEY is not a test key in non-production environment');
    }
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    await stripe.balance.retrieve({ timeout: 5000 });
    console.log('✅ Stripe initialized and connection verified');
  } catch (error) {
    console.error('ERROR: Failed to initialize Stripe:', error.message);
    console.log('Retrying Stripe initialization in 5 seconds...');
    setTimeout(initializeStripe, 5000);
  }
}
initializeStripe();

const app = express();

// Determine if running in Vercel serverless environment
const isVercelServerless = process.env.VERCEL || process.env.NODE_ENV === 'production';

// Create uploads directory (only for local development)
const uploadsDir = isVercelServerless ? '/tmp' : 'uploads';
if (!isVercelServerless && !fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
  console.log('✅ Created uploads directory');
}

// Middleware to normalize URLs
app.use((req, res, next) => {
  req.url = req.url.replace(/\/+/g, '/');
  next();
});

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  process.env.FRONTEND_URL || 'https://alatree-ventures-assignments-dobl-frkce6h7n.vercel.app'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`CORS blocked: Origin ${origin} not allowed`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());

// Increase payload size limits for file uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Static file serving (only in development)
if (!isVercelServerless) {
  app.use('/uploads', express.static('uploads'));
}

// MongoDB Connection with retry
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/top216';
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
    });
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('ERROR: MongoDB connection failed:', error.message);
    console.log('Retrying MongoDB connection in 5 seconds...');
    setTimeout(connectDB, 5000);
  }
};
connectDB();

// Middleware to check MongoDB connection
const checkMongoDBConnection = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    console.error('MongoDB not connected, rejecting request:', req.originalUrl);
    return res.status(503).json({ error: 'Service unavailable: Database not connected' });
  }
  next();
};

// Middleware to check Stripe initialization
const checkStripeInitialized = (req, res, next) => {
  if (!stripe) {
    console.error('Stripe not initialized, rejecting request:', req.originalUrl);
    return res.status(503).json({ error: 'Service unavailable: Stripe not initialized' });
  }
  next();
};

// Entry Schema
const entrySchema = new mongoose.Schema({
  userId: { type: String, required: true },
  category: { type: String, required: true, enum: ['business', 'creative', 'technology', 'social-impact'] },
  entryType: { type: String, required: true, enum: ['text', 'pitch-deck', 'video'] },
  title: { type: String, required: true, minlength: 5, maxlength: 100 },
  description: { type: String, maxlength: 1000 },
  textContent: {
    type: String,
    validate: {
      validator: function (v) {
        if (this.entryType === 'text') {
          const wordCount = v ? v.split(/\s+/).filter(word => word.length > 0).length : 0;
          return wordCount >= 100 && wordCount <= 2000;
        }
        return true;
      },
      message: 'Text entries must be between 100-2000 words'
    }
  },
  fileData: {
    type: String,
    validate: {
      validator: function (v) {
        if (this.entryType === 'pitch-deck') {
          return !!v || !!this.fileUrl;
        }
        return true;
      },
      message: 'File data required for pitch deck entries'
    }
  },
  fileName: String,
  fileType: String,
  fileSize: Number,
  fileUrl: {
    type: String,
    validate: {
      validator: function (v) {
        if (this.entryType === 'pitch-deck') {
          return !!v || !!this.fileData;
        }
        return true;
      },
      message: 'File URL or file data required for pitch deck entries'
    }
  },
  videoUrl: {
    type: String,
    validate: {
      validator: function (v) {
        if (this.entryType === 'video' && v) {
          const urlPattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|vimeo\.com)/i;
          return urlPattern.test(v);
        }
        return this.entryType !== 'video' || !!v;
      },
      message: 'Valid YouTube or Vimeo URL required for video entries'
    }
  },
  entryFee: { type: Number, required: true },
  stripeFee: { type: Number, required: true },
  totalAmount: { type: Number, required: true },
  paymentIntentId: { type: String, required: true },
  paymentStatus: { type: String, enum: ['pending', 'succeeded', 'failed'], default: 'pending' },
  submissionDate: { type: Date, default: Date.now },
  status: { type: String, enum: ['submitted', 'under-review', 'finalist', 'winner', 'rejected'], default: 'submitted' }
}, { timestamps: true });

const Entry = mongoose.model('Entry', entrySchema);

// File upload configuration
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const allowedTypes = {
    'application/pdf': '.pdf',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx'
  };
  if (allowedTypes[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF and PPT files are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { 
    fileSize: isVercelServerless ? 4 * 1024 * 1024 : 25 * 1024 * 1024
  },
  fileFilter: fileFilter
}).single('file');

// Helper function to calculate fees
const calculateFees = (baseAmount) => {
  const stripeFee = Math.ceil(baseAmount * 0.04);
  const totalAmount = baseAmount + stripeFee;
  return { stripeFee, totalAmount };
};

// Routes
app.get('/', (req, res) => {
  try {
    res.json({ 
      message: 'Top 216 API Server',
      status: 'running',
      environment: isVercelServerless ? 'serverless' : 'local',
      timestamp: new Date().toISOString(),
      endpoints: {
        health: '/api/health',
        createPaymentIntent: '/api/create-payment-intent',
        submitEntry: '/api/entries',
        getUserEntries: '/api/entries/:userId'
      }
    });
  } catch (error) {
    console.error('Error in root route:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

app.get('/api/health', (req, res) => {
  try {
    res.json({ 
      status: 'OK', 
      message: 'Server is running',
      environment: isVercelServerless ? 'serverless' : 'local',
      timestamp: new Date().toISOString(),
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      stripe: !!stripe ? 'initialized' : 'not initialized'
    });
  } catch (error) {
    console.error('Error in health route:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

app.get('/api/create-test-entry/:userId', checkMongoDBConnection, async (req, res) => {
  try {
    console.log('Creating test entry for user:', req.params.userId);
    const userId = req.params.userId;
    const textContent = `This is a comprehensive business strategy...`.repeat(2);
    const entry = new Entry({
      userId,
      category: 'business',
      entryType: 'text',
      title: 'Sample Business Strategy Entry',
      description: 'A comprehensive business strategy for digital transformation in modern enterprises',
      textContent: textContent,
      entryFee: 49,
      stripeFee: 2,
      totalAmount: 51,
      paymentIntentId: 'pi_test_' + Date.now(),
      paymentStatus: 'succeeded'
    });
    
    await entry.save();
    console.log('Test entry created:', entry._id);
    res.json({ 
      message: 'Test entry created successfully', 
      id: entry._id,
      title: entry.title 
    });
  } catch (error) {
    console.error('Error creating test entry:', error.message);
    res.status(500).json({ error: 'Failed to create test entry', message: error.message });
  }
});

app.get('/api/create-test-entries/:userId', checkMongoDBConnection, async (req, res) => {
  try {
    console.log('Creating test entries for user:', req.params.userId);
    const userId = req.params.userId;
    const baseTextContent = `This business strategy focuses on digital transformation...`.repeat(3);
    const testEntries = [
      {
        userId,
        category: 'business',
        entryType: 'text',
        title: 'Innovative Business Strategy',
        description: 'A comprehensive business strategy for modern markets',
        textContent: baseTextContent,
        entryFee: 49,
        stripeFee: 2,
        totalAmount: 51,
        paymentIntentId: 'pi_test_business_' + Date.now(),
        paymentStatus: 'succeeded',
        status: 'submitted'
      },
      {
        userId,
        category: 'technology',
        entryType: 'text',
        title: 'AI-Powered Solution Platform',
        description: 'Revolutionary AI application for enterprise automation',
        textContent: baseTextContent.replace('business strategy', 'AI technology solution'),
        entryFee: 99,
        stripeFee: 4,
        totalAmount: 103,
        paymentIntentId: 'pi_test_tech_' + Date.now(),
        paymentStatus: 'succeeded',
        status: 'under-review'
      },
      {
        userId,
        category: 'creative',
        entryType: 'video',
        title: 'Creative Digital Showcase',
        description: 'Artistic expression through innovative digital media',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        entryFee: 49,
        stripeFee: 2,
        totalAmount: 51,
        paymentIntentId: 'pi_test_creative_' + Date.now(),
        paymentStatus: 'succeeded',
        status: 'finalist'
      }
    ];

    const savedEntries = await Entry.insertMany(testEntries);
    console.log(`Created ${savedEntries.length} test entries for user: ${userId}`);
    res.json({ 
      message: `Created ${savedEntries.length} test entries successfully`,
      entries: savedEntries.map(e => ({ id: e._id, title: e.title, status: e.status }))
    });
  } catch (error) {
    console.error('Error creating test entries:', error.message);
    res.status(500).json({ error: 'Failed to create test entries', message: error.message });
  }
});

app.post('/api/create-payment-intent', checkStripeInitialized, async (req, res) => {
  try {
    console.log('Payment intent request received:', {
      body: req.body,
      origin: req.headers.origin
    });
    const { category, entryType } = req.body;
    
    if (!category || !entryType) {
      return res.status(400).json({ 
        error: 'Category and entryType are required',
        received: { category, entryType }
      });
    }

    const baseFees = { 'business': 49, 'creative': 49, 'technology': 99, 'social-impact': 49 };
    const entryFee = baseFees[category];
    
    if (!entryFee) {
      return res.status(400).json({ 
        error: 'Invalid category',
        validCategories: Object.keys(baseFees),
        received: category
      });
    }

    const { stripeFee, totalAmount } = calculateFees(entryFee);
    console.log('Creating payment intent with amount:', totalAmount * 100, 'cents');

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount * 100,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: { category, entryType, entryFee: entryFee.toString(), stripeFee: stripeFee.toString() }
    }, { timeout: 5000 });

    console.log('Payment intent created successfully:', paymentIntent.id);
    res.json({ 
      clientSecret: paymentIntent.client_secret, 
      entryFee, 
      stripeFee, 
      totalAmount 
    });
  } catch (error) {
    console.error('Error creating payment intent:', error.message);
    res.status(500).json({ 
      error: 'Failed to create payment intent',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.post('/api/entries', (req, res, next) => {
  upload(req, res, (err) => {
    if (err) {
      console.error('Multer error:', err.message);
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, checkMongoDBConnection, checkStripeInitialized, async (req, res) => {
  try {
    console.log('Entry submission started:', {
      body: req.body,
      file: req.file ? { filename: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype } : null
    });

    const { userId, category, entryType, title, description, textContent, videoUrl, paymentIntentId } = req.body;
    
    if (!userId || !category || !entryType || !title || !paymentIntentId) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['userId', 'category', 'entryType', 'title', 'paymentIntentId'],
        received: { userId, category, entryType, title, paymentIntentId }
      });
    }

    if (entryType === 'pitch-deck') {
      if (!req.file) {
        return res.status(400).json({ error: 'File required for pitch-deck entries' });
      }
      
      const allowedTypes = [
        'application/pdf',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ];
      
      if (!allowedTypes.includes(req.file.mimetype)) {
        return res.status(400).json({ error: 'Invalid file type. Only PDF, PPT, PPTX allowed.' });
      }
      
      const maxSize = isVercelServerless ? 4 * 1024 * 1024 : 25 * 1024 * 1024;
      if (req.file.size > maxSize) {
        return res.status(400).json({ 
          error: `File size exceeds ${isVercelServerless ? '4MB' : '25MB'} limit.` 
        });
      }
    }

    console.log('Verifying payment intent:', paymentIntentId);
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, { timeout: 5000 });
    
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ 
        error: 'Payment not completed',
        paymentStatus: paymentIntent.status
      });
    }

    const entryFee = parseInt(paymentIntent.metadata.entryFee);
    const stripeFee = parseInt(paymentIntent.metadata.stripeFee);
    const totalAmount = entryFee + stripeFee;

    const entryData = {
      userId,
      category,
      entryType,
      title,
      description,
      entryFee,
      stripeFee,
      totalAmount,
      paymentIntentId,
      paymentStatus: 'succeeded'
    };

    if (entryType === 'text') {
      entryData.textContent = textContent;
    } else if (entryType === 'pitch-deck' && req.file) {
      entryData.fileData = req.file.buffer.toString('base64');
      entryData.fileName = req.file.originalname;
      entryData.fileType = req.file.mimetype;
      entryData.fileSize = req.file.size;
      entryData.fileUrl = `/api/file/${paymentIntentId}`;
    } else if (entryType === 'video') {
      entryData.videoUrl = videoUrl;
    }

    console.log('Creating entry with data:', { ...entryData, fileData: entryData.fileData ? '[BASE64_DATA]' : undefined });
    const entry = new Entry(entryData);
    await entry.save();
    
    console.log('Entry created successfully:', entry._id);
    res.status(201).json({ message: 'Entry submitted successfully', entryId: entry._id });
  } catch (error) {
    console.error('Error submitting entry:', error.message);
    res.status(500).json({ 
      error: 'Failed to submit entry',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.get('/api/file/:paymentIntentId', checkMongoDBConnection, async (req, res) => {
  try {
    console.log('Fetching file for paymentIntentId:', req.params.paymentIntentId);
    const entry = await Entry.findOne({ paymentIntentId: req.params.paymentIntentId }).lean();
    
    if (!entry || !entry.fileData) {
      return res.status(404).json({ error: 'File not found' });
    }

    const fileBuffer = Buffer.from(entry.fileData, 'base64');
    
    res.setHeader('Content-Type', entry.fileType);
    res.setHeader('Content-Disposition', `attachment; filename="${entry.fileName}"`);
    res.setHeader('Content-Length', entry.fileSize);
    
    res.send(fileBuffer);
  } catch (error) {
    console.error('Error serving file:', error.message);
    res.status(500).json({ error: 'Failed to serve file', message: error.message });
  }
});

app.get('/api/entries/:userId', checkMongoDBConnection, async (req, res) => {
  try {
    console.log('Fetching entries for user:', req.params.userId);
    const entries = await Entry.find({ userId: req.params.userId }).sort({ createdAt: -1 }).lean();
    
    const transformedEntries = entries.map(entry => {
      if (entry.entryType === 'pitch-deck' && entry.fileData) {
        entry.fileUrl = `/api/file/${entry.paymentIntentId}`;
      }
      delete entry.fileData;
      return entry;
    });
    
    console.log(`Found ${transformedEntries.length} entries for user:`, req.params.userId);
    res.json(transformedEntries);
  } catch (error) {
    console.error('Error fetching entries:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch entries',
      message: error.message
    });
  }
});

app.get('/api/entry/:id', checkMongoDBConnection, async (req, res) => {
  try {
    console.log('Fetching entry:', req.params.id);
    const entry = await Entry.findById(req.params.id).lean();
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    if (entry.entryType === 'pitch-deck' && entry.fileData) {
      entry.fileUrl = `/api/file/${entry.paymentIntentId}`;
    }
    delete entry.fileData;
    res.json(entry);
  } catch (error) {
    console.error('Error fetching entry:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch entry',
      message: error.message
    });
  }
});

app.delete('/api/entries/:id', checkMongoDBConnection, async (req, res) => {
  try {
    const entryId = req.params.id;
    const { userId } = req.body;
    console.log('Deleting entry:', entryId, 'for user:', userId);
    
    const entry = await Entry.findById(entryId).lean();
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    if (entry.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to delete this entry' });
    }
    
    await Entry.findByIdAndDelete(entryId);
    console.log('Entry deleted successfully:', entryId);
    res.json({ message: 'Entry deleted successfully' });
  } catch (error) {
    console.error('Error deleting entry:', error.message);
    res.status(500).json({ 
      error: 'Failed to delete entry',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  try {
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      throw new Error('STRIPE_WEBHOOK_SECRET not found in environment variables');
    }
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('Webhook event received:', event.type);
    
    if (event.type === 'payment_intent.payment_failed') {
      console.log('Handling payment failed for:', event.data.object.id);
      Entry.findOneAndUpdate(
        { paymentIntentId: event.data.object.id },
        { paymentStatus: 'failed' }
      ).exec();
    }
    
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(400).json({ error: 'Webhook error', message: err.message });
  }
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error.message, error.stack);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });
});

// Handle uncaught exceptions and promise rejections
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error.message, error.stack);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;

const PORT = process.env.PORT || 5000;
if (!isVercelServerless) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log(`🧪 Create test entry: http://localhost:${PORT}/api/create-test-entry/user_test123`);
  });
}
