const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();

// Initialize Express app
const app = express();

// Determine if running in Vercel serverless environment
const isVercelServerless = process.env.VERCEL || process.env.VERCEL_ENV;

// Global connection variables
let mongoConnection = null;
let stripe = null;

// Initialize Stripe
async function initializeStripe() {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY not found in environment variables');
    }
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('✅ Stripe initialized');
    return true;
  } catch (error) {
    console.error('ERROR: Failed to initialize Stripe:', error.message);
    return false;
  }
}

// Initialize MongoDB connection
async function initializeMongoDB() {
  try {
    if (mongoConnection && mongoose.connection.readyState === 1) {
      return mongoConnection;
    }

    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
      throw new Error('MONGODB_URI not found in environment variables');
    }

    // Close existing connection if any
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }

    mongoConnection = await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
      bufferCommands: false,
    });

    console.log('✅ MongoDB connected successfully');
    return mongoConnection;
  } catch (error) {
    console.error('ERROR: MongoDB connection failed:', error.message);
    throw error;
  }
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
  process.env.FRONTEND_URL,
  'https://alatree-ventures-assignments-dobl-frkce6h7n.vercel.app'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

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
  fileData: String,
  fileName: String,
  fileType: String,
  fileSize: Number,
  fileUrl: String,
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

// Create model function to avoid OverwriteModelError
function getEntryModel() {
  try {
    return mongoose.model('Entry');
  } catch (error) {
    return mongoose.model('Entry', entrySchema);
  }
}

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
    fileSize: 4 * 1024 * 1024 // 4MB limit for Vercel
  },
  fileFilter: fileFilter
}).single('file');

// Helper function to calculate fees
const calculateFees = (baseAmount) => {
  const stripeFee = Math.ceil(baseAmount * 0.04);
  const totalAmount = baseAmount + stripeFee;
  return { stripeFee, totalAmount };
};

// Middleware to initialize services
const initializeServices = async (req, res, next) => {
  try {
    // Initialize MongoDB
    if (!mongoConnection || mongoose.connection.readyState !== 1) {
      await initializeMongoDB();
    }
    
    // Initialize Stripe
    if (!stripe) {
      const stripeInitialized = await initializeStripe();
      if (!stripeInitialized) {
        return res.status(503).json({ error: 'Service unavailable: Stripe not initialized' });
      }
    }
    
    next();
  } catch (error) {
    console.error('Service initialization error:', error.message);
    res.status(503).json({ error: 'Service unavailable', message: error.message });
  }
};

// Routes
app.get('/', async (req, res) => {
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

app.get('/api/health', async (req, res) => {
  try {
    let mongoStatus = 'disconnected';
    let stripeStatus = 'not initialized';
    
    try {
      if (mongoose.connection.readyState === 1) {
        mongoStatus = 'connected';
      } else {
        await initializeMongoDB();
        mongoStatus = 'connected';
      }
    } catch (error) {
      mongoStatus = `error: ${error.message}`;
    }
    
    try {
      if (!stripe) {
        await initializeStripe();
      }
      stripeStatus = stripe ? 'initialized' : 'failed';
    } catch (error) {
      stripeStatus = `error: ${error.message}`;
    }
    
    res.json({ 
      status: 'OK', 
      message: 'Server is running',
      environment: isVercelServerless ? 'serverless' : 'local',
      timestamp: new Date().toISOString(),
      mongodb: mongoStatus,
      stripe: stripeStatus,
      nodeVersion: process.version,
      platform: process.platform
    });
  } catch (error) {
    console.error('Error in health route:', error.message);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

app.post('/api/create-payment-intent', initializeServices, async (req, res) => {
  try {
    console.log('Payment intent request received:', req.body);
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
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount * 100,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: { 
        category, 
        entryType, 
        entryFee: entryFee.toString(), 
        stripeFee: stripeFee.toString() 
      }
    });

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
      message: error.message
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
}, initializeServices, async (req, res) => {
  try {
    console.log('Entry submission started:', {
      body: req.body,
      file: req.file ? { filename: req.file.originalname, size: req.file.size } : null
    });

    const { userId, category, entryType, title, description, textContent, videoUrl, paymentIntentId } = req.body;
    
    if (!userId || !category || !entryType || !title || !paymentIntentId) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['userId', 'category', 'entryType', 'title', 'paymentIntentId']
      });
    }

    // Validate file for pitch-deck entries
    if (entryType === 'pitch-deck' && !req.file) {
      return res.status(400).json({ error: 'File required for pitch-deck entries' });
    }

    // Verify payment
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
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

    const Entry = getEntryModel();
    const entry = new Entry(entryData);
    await entry.save();
    
    console.log('Entry created successfully:', entry._id);
    res.status(201).json({ message: 'Entry submitted successfully', entryId: entry._id });
  } catch (error) {
    console.error('Error submitting entry:', error.message);
    res.status(500).json({ 
      error: 'Failed to submit entry',
      message: error.message
    });
  }
});

app.get('/api/entries/:userId', initializeServices, async (req, res) => {
  try {
    console.log('Fetching entries for user:', req.params.userId);
    const Entry = getEntryModel();
    const entries = await Entry.find({ userId: req.params.userId }).sort({ createdAt: -1 }).lean();
    
    const transformedEntries = entries.map(entry => {
      if (entry.entryType === 'pitch-deck' && entry.fileData) {
        entry.fileUrl = `/api/file/${entry.paymentIntentId}`;
        delete entry.fileData; // Remove base64 data from response
      }
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

app.get('/api/file/:paymentIntentId', initializeServices, async (req, res) => {
  try {
    console.log('Fetching file for paymentIntentId:', req.params.paymentIntentId);
    const Entry = getEntryModel();
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

app.delete('/api/entries/:id', initializeServices, async (req, res) => {
  try {
    const entryId = req.params.id;
    const { userId } = req.body;
    console.log('Deleting entry:', entryId, 'for user:', userId);
    
    const Entry = getEntryModel();
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
      message: error.message
    });
  }
});

// Webhook endpoint with raw body parsing
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  try {
    if (!stripe) {
      await initializeStripe();
    }
    
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      throw new Error('STRIPE_WEBHOOK_SECRET not found in environment variables');
    }
    
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('Webhook event received:', event.type);
    
    if (event.type === 'payment_intent.payment_failed') {
      console.log('Handling payment failed for:', event.data.object.id);
      const Entry = getEntryModel();
      await Entry.findOneAndUpdate(
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

// Test routes for development
app.get('/api/create-test-entry/:userId', initializeServices, async (req, res) => {
  try {
    console.log('Creating test entry for user:', req.params.userId);
    const userId = req.params.userId;
    const textContent = `This is a comprehensive business strategy for digital transformation in modern enterprises. We focus on leveraging cutting-edge technologies to streamline operations, enhance customer experience, and drive sustainable growth. Our approach encompasses market analysis, competitive positioning, resource allocation, and strategic partnerships. The implementation roadmap includes phases for technology adoption, team training, and performance monitoring to ensure successful transformation outcomes.`.repeat(2);
    
    const Entry = getEntryModel();
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

// Global error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error.message);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// Export for Vercel
module.exports = app;

// Only start server if not in Vercel environment
const PORT = process.env.PORT || 5000;
if (!isVercelServerless) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  });
}
