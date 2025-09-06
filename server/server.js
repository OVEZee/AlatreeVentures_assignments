const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Initialize Stripe with error checking
let stripe;
try {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('ERROR: STRIPE_SECRET_KEY not found in environment variables');
    throw new Error('Missing STRIPE_SECRET_KEY environment variable');
  }
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  console.log('✅ Stripe initialized successfully');
} catch (error) {
  console.error('ERROR: Failed to initialize Stripe:', error.message);
  // Don't exit in serverless - let the function handle the error gracefully
}

const app = express();

// Detect Vercel environment more reliably
const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV);

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));

// Important: Raw middleware for webhooks BEFORE express.json()
app.use('/api/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

// Only create uploads directory in local development
if (!isVercel) {
  const uploadsDir = 'uploads';
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
    console.log('✅ Created uploads directory');
  }
  app.use('/uploads', express.static('uploads'));
}

// MongoDB connection with better error handling for serverless
let cachedConnection = null;

const connectDB = async () => {
  // Check if we already have a healthy connection
  if (cachedConnection && mongoose.connection.readyState === 1) {
    return cachedConnection;
  }
  
  try {
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
      throw new Error('MONGODB_URI environment variable is not set');
    }
    
    console.log('Connecting to MongoDB...');
    
    // Disconnect if there's a stale connection
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    
    const conn = await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      bufferCommands: false,
      bufferMaxEntries: 0,
      maxPoolSize: 5, // Reduced for serverless
      serverSelectionTimeoutMS: 10000, // 10 seconds
      socketTimeoutMS: 45000,
      maxIdleTimeMS: 30000,
      heartbeatFrequencyMS: 10000
    });
    
    cachedConnection = conn;
    console.log('✅ MongoDB connected successfully');
    return conn;
  } catch (error) {
    console.error('ERROR: MongoDB connection failed:', error.message);
    cachedConnection = null;
    throw error;
  }
};

// Entry Schema - Define once to prevent re-compilation errors
const entrySchema = new mongoose.Schema({
  userId: { type: String, required: true },
  category: { 
    type: String, 
    required: true, 
    enum: ['business', 'creative', 'technology', 'social-impact'] 
  },
  entryType: { 
    type: String, 
    required: true, 
    enum: ['text', 'pitch-deck', 'video'] 
  },
  title: { 
    type: String, 
    required: true, 
    minlength: 5, 
    maxlength: 100 
  },
  description: { 
    type: String, 
    maxlength: 1000 
  },
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
  fileUrl: {
    type: String,
    validate: {
      validator: function (v) {
        if (this.entryType === 'pitch-deck') {
          return !!v;
        }
        return true;
      },
      message: 'File URL required for pitch deck entries'
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
  paymentStatus: { 
    type: String, 
    enum: ['pending', 'succeeded', 'failed'], 
    default: 'pending' 
  },
  submissionDate: { type: Date, default: Date.now },
  status: { 
    type: String, 
    enum: ['submitted', 'under-review', 'finalist', 'winner', 'rejected'], 
    default: 'submitted' 
  }
}, { 
  timestamps: true,
  collection: 'entries' // Explicitly set collection name
});

// Prevent model re-compilation in serverless environment
const Entry = mongoose.models.Entry || mongoose.model('Entry', entrySchema);

// File upload configuration for Vercel
const storage = multer.memoryStorage(); // Use memory storage for serverless

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
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
  fileFilter: fileFilter
});

// Helper function to calculate fees
const calculateFees = (baseAmount) => {
  const stripeFee = Math.ceil(baseAmount * 0.04); // 4% fee, rounded up
  const totalAmount = baseAmount + stripeFee;
  return { stripeFee, totalAmount };
};

// Database connection middleware with timeout
app.use(async (req, res, next) => {
  // Skip database connection for health check
  if (req.path === '/api/health') {
    return next();
  }
  
  try {
    await Promise.race([
      connectDB(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database connection timeout')), 8000)
      )
    ]);
    next();
  } catch (error) {
    console.error('Database connection error:', error.message);
    res.status(503).json({ 
      error: 'Service temporarily unavailable',
      message: 'Database connection failed'
    });
  }
});

// Routes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: isVercel ? 'vercel' : 'local',
    nodeVersion: process.version,
    platform: process.platform
  });
});

app.post('/api/create-payment-intent', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: 'Payment processing not available' });
    }
    
    console.log('Payment intent request received:', req.body);
    const { category, entryType } = req.body;
    
    if (!category || !entryType) {
      return res.status(400).json({ 
        error: 'Category and entryType are required',
        received: { category, entryType }
      });
    }
    
    const baseFees = { 
      'business': 49, 
      'creative': 49, 
      'technology': 99, 
      'social-impact': 49 
    };
    
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
      automatic_payment_methods: {
        enabled: true,
      },
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
    console.error('Error creating payment intent:', error);
    res.status(500).json({ 
      error: 'Failed to create payment intent',
      message: error.message
    });
  }
});

app.post('/api/entries', upload.single('file'), async (req, res) => {
  try {
    console.log('Entry submission received:', {
      body: req.body,
      file: req.file ? { 
        originalname: req.file.originalname, 
        size: req.file.size,
        mimetype: req.file.mimetype 
      } : null
    });
    
    const { 
      userId, 
      category, 
      entryType, 
      title, 
      description, 
      textContent, 
      videoUrl, 
      paymentIntentId 
    } = req.body;
    
    // Validate required fields
    if (!userId || !category || !entryType || !title || !paymentIntentId) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['userId', 'category', 'entryType', 'title', 'paymentIntentId'],
        received: { userId, category, entryType, title, paymentIntentId }
      });
    }

    // Server-side file validation for pitch-deck
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
        return res.status(400).json({ 
          error: 'Invalid file type. Only PDF, PPT, PPTX allowed.',
          received: req.file.mimetype
        });
      }
      
      if (req.file.size > 25 * 1024 * 1024) {
        return res.status(400).json({ error: 'File size exceeds 25MB limit.' });
      }
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Payment processing not available' });
    }

    console.log('Verifying payment intent:', paymentIntentId);
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
      description: description || '',
      entryFee,
      stripeFee,
      totalAmount,
      paymentIntentId,
      paymentStatus: 'succeeded'
    };
    
    if (entryType === 'text') {
      entryData.textContent = textContent;
    } else if (entryType === 'pitch-deck' && req.file) {
      // For Vercel, you'd typically upload to cloud storage (S3, Cloudinary, etc.)
      // This is a temporary solution - in production, upload to cloud storage
      entryData.fileUrl = `temp://${req.file.originalname}`;
      console.log('⚠️ File uploaded to memory - implement cloud storage for production');
    } else if (entryType === 'video') {
      entryData.videoUrl = videoUrl;
    }
    
    console.log('Creating entry with data:', { ...entryData, textContent: entryData.textContent ? '[TRUNCATED]' : undefined });
    
    const entry = new Entry(entryData);
    const savedEntry = await entry.save();
    
    console.log('Entry created successfully:', savedEntry._id);
    res.status(201).json({ 
      message: 'Entry submitted successfully', 
      entryId: savedEntry._id 
    });
  } catch (error) {
    console.error('Error submitting entry:', error);
    
    // Handle specific validation errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        error: 'Validation failed',
        details: Object.values(error.errors).map(err => err.message)
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to submit entry',
      message: error.message
    });
  }
});

app.get('/api/entries/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    console.log('Fetching entries for user:', userId);
    
    const entries = await Entry.find({ userId }).sort({ createdAt: -1 }).lean();
    console.log(`Found ${entries.length} entries for user:`, userId);
    
    res.json(entries);
  } catch (error) {
    console.error('Error fetching entries:', error);
    res.status(500).json({ 
      error: 'Failed to fetch entries',
      message: error.message
    });
  }
});

app.get('/api/entry/:id', async (req, res) => {
  try {
    const entryId = req.params.id;
    
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(entryId)) {
      return res.status(400).json({ error: 'Invalid entry ID format' });
    }
    
    const entry = await Entry.findById(entryId).lean();
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    res.json(entry);
  } catch (error) {
    console.error('Error fetching entry:', error);
    res.status(500).json({ 
      error: 'Failed to fetch entry',
      message: error.message
    });
  }
});

app.delete('/api/entries/:id', async (req, res) => {
  try {
    const entryId = req.params.id;
    const { userId } = req.body;
    
    console.log('Deleting entry:', entryId, 'for user:', userId);
    
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(entryId)) {
      return res.status(400).json({ error: 'Invalid entry ID format' });
    }
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }
    
    const entry = await Entry.findById(entryId);
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
    console.error('Error deleting entry:', error);
    res.status(500).json({ 
      error: 'Failed to delete entry',
      message: error.message
    });
  }
});

// Test routes for development
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/create-test-entry/:userId', async (req, res) => {
    try {
      const userId = req.params.userId;
      const entry = new Entry({
        userId,
        category: 'business',
        entryType: 'text',
        title: 'Sample Business Strategy Entry',
        description: 'A comprehensive business strategy for digital transformation',
        textContent: 'This is a detailed business strategy that focuses on leveraging digital technologies to transform traditional business models. The strategy encompasses customer experience enhancement, operational efficiency improvements, and data-driven decision making. By implementing these digital transformation initiatives, organizations can achieve sustainable competitive advantages in the modern marketplace. The approach involves careful planning, stakeholder alignment, and phased implementation to ensure successful adoption across all business units. Digital transformation requires a holistic view of technology integration, process optimization, and cultural change management. Organizations must evaluate their current state, define their digital vision, and create a roadmap for transformation that aligns with business objectives and market opportunities.'.repeat(2),
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
      console.error('Error creating test entry:', error);
      res.status(500).json({ error: error.message });
    }
  });
}

// Webhook route with better error handling
app.post('/api/webhook', async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('Stripe webhook not configured properly');
    return res.status(500).json({ error: 'Webhook not configured' });
  }
  
  const sig = req.headers['stripe-signature'];
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  try {
    if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object;
      await Entry.findOneAndUpdate(
        { paymentIntentId: paymentIntent.id },
        { paymentStatus: 'failed' }
      );
      console.log('Updated payment status to failed for:', paymentIntent.id);
    }
    
    res.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  
  // Handle multer errors
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 25MB.' });
    }
    return res.status(400).json({ error: `Upload error: ${error.message}` });
  }
  
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// For local development
if (!isVercel) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, async () => {
    try {
      await connectDB();
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🧪 Create test entry: http://localhost:${PORT}/api/create-test-entry/user_test123`);
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  });
}

// Export for Vercel - this is crucial!
module.exports = app;
