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
    console.log('Please add STRIPE_SECRET_KEY to your .env file');
    process.exit(1);
  }
  // Allow both test and live keys in production
  if (process.env.NODE_ENV !== 'production' && !process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
    console.error('ERROR: STRIPE_SECRET_KEY is not a test key. Please use a test key in test mode.');
    process.exit(1);
  }
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  console.log('✅ Stripe initialized successfully');
} catch (error) {
  console.error('ERROR: Failed to initialize Stripe:', error.message);
  process.exit(1);
}

const app = express();

// Determine if running in Vercel serverless environment
const isVercelServerless = process.env.VERCEL || process.env.NODE_ENV === 'production';

// Create uploads directory (only for local development)
const uploadsDir = isVercelServerless ? '/tmp' : 'uploads';
if (!isVercelServerless && !fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
  console.log('✅ Created uploads directory');
}

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173', 'https://alatree-ventures-assignments-dobl-frkce6h7n.vercel.app'],
  credentials: true
}));

// Increase payload size limits for file uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Static file serving (only in development)
if (!isVercelServerless) {
  app.use('/uploads', express.static('uploads'));
}

// MongoDB Connection with error handling
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/top216';
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('ERROR: MongoDB connection failed:', error.message);
    if (!isVercelServerless) {
      console.log('Make sure MongoDB is running on your system');
    }
    process.exit(1);
  }
};

connectDB();

// Entry Schema - Updated for serverless compatibility
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
  // For serverless, we'll store file data differently
  fileData: {
    type: String, // Base64 encoded file data for small files
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
  fileName: String, // Original filename
  fileType: String, // MIME type
  fileSize: Number, // File size in bytes
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

// Improved file upload configuration for serverless
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
  limits: { 
    fileSize: isVercelServerless ? 4 * 1024 * 1024 : 25 * 1024 * 1024 // 4MB for serverless, 25MB for local
  },
  fileFilter: fileFilter
});

// Helper function to calculate fees
const calculateFees = (baseAmount) => {
  const stripeFee = Math.ceil(baseAmount * 0.04); // 4% fee, rounded up
  const totalAmount = baseAmount + stripeFee;
  return { stripeFee, totalAmount };
};

// Routes
app.get('/', (req, res) => {
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
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    environment: isVercelServerless ? 'serverless' : 'local',
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    stripe: !!stripe ? 'initialized' : 'not initialized'
  });
});

app.get('/api/create-test-entry/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    // Create a longer text content to meet word count requirement
    const textContent = `This is a comprehensive business strategy for digital transformation in modern enterprises. The strategy encompasses multiple key areas including technology adoption, organizational change management, customer experience enhancement, and operational efficiency improvements. 

In today's rapidly evolving business landscape, companies must adapt to survive and thrive. This strategy outlines a systematic approach to digital transformation that addresses the core challenges facing modern organizations. The framework includes assessment of current capabilities, identification of transformation opportunities, development of implementation roadmaps, and establishment of success metrics.

Key components of this strategy include customer-centric design thinking, agile methodology adoption, cloud-first technology architecture, data-driven decision making, and continuous learning culture development. The implementation approach emphasizes iterative progress with quick wins while building toward long-term strategic objectives.

Success will be measured through multiple KPIs including customer satisfaction scores, operational efficiency metrics, employee engagement levels, and financial performance indicators. Regular review cycles will ensure the strategy remains aligned with market conditions and business objectives.`.repeat(2);

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
    console.error('Error creating test entry:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/create-test-entries/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const baseTextContent = `This business strategy focuses on digital transformation and innovative approaches to modern market challenges. The comprehensive plan includes detailed analysis of current market conditions, competitive landscape assessment, customer needs evaluation, and technology trend analysis. 

The strategy encompasses multiple phases of implementation including initial assessment, pilot program development, full-scale rollout, and performance optimization. Each phase includes specific deliverables, timelines, and success metrics to ensure effective execution and measurable results.

Key focus areas include customer experience enhancement, operational efficiency improvements, technology infrastructure modernization, and workforce capability development. The approach emphasizes sustainable growth while maintaining competitive advantages in an evolving marketplace.

Success metrics include revenue growth, customer satisfaction improvement, operational cost reduction, and market share expansion. Regular performance reviews and strategy adjustments ensure continued alignment with business objectives and market dynamics.`.repeat(3);

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
        entryType: 'text', // Changed from pitch-deck to text for serverless compatibility
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
    console.error('Error creating test entries:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/create-payment-intent', async (req, res) => {
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
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.post('/api/entries', upload.single('file'), async (req, res) => {
  try {
    console.log('Entry submission received:', {
      body: req.body,
      file: req.file ? { 
        filename: req.file.originalname, 
        size: req.file.size,
        mimetype: req.file.mimetype 
      } : null
    });

    const { userId, category, entryType, title, description, textContent, videoUrl, paymentIntentId } = req.body;
    
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
      // For serverless, store file as base64 data
      entryData.fileData = req.file.buffer.toString('base64');
      entryData.fileName = req.file.originalname;
      entryData.fileType = req.file.mimetype;
      entryData.fileSize = req.file.size;
      entryData.fileUrl = `/api/file/${paymentIntentId}`; // Virtual URL for file access
    } else if (entryType === 'video') {
      entryData.videoUrl = videoUrl;
    }

    console.log('Creating entry with data:', { ...entryData, fileData: entryData.fileData ? '[BASE64_DATA]' : undefined });
    const entry = new Entry(entryData);
    await entry.save();
    
    console.log('Entry created successfully:', entry._id);
    res.status(201).json({ message: 'Entry submitted successfully', entryId: entry._id });
  } catch (error) {
    console.error('Error submitting entry:', error);
    res.status(500).json({ 
      error: 'Failed to submit entry',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// File serving endpoint for serverless environment
app.get('/api/file/:paymentIntentId', async (req, res) => {
  try {
    const entry = await Entry.findOne({ paymentIntentId: req.params.paymentIntentId });
    
    if (!entry || !entry.fileData) {
      return res.status(404).json({ error: 'File not found' });
    }

    const fileBuffer = Buffer.from(entry.fileData, 'base64');
    
    res.setHeader('Content-Type', entry.fileType);
    res.setHeader('Content-Disposition', `attachment; filename="${entry.fileName}"`);
    res.setHeader('Content-Length', entry.fileSize);
    
    res.send(fileBuffer);
  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

app.get('/api/entries/:userId', async (req, res) => {
  try {
    console.log('Fetching entries for user:', req.params.userId);
    const entries = await Entry.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    
    // Transform entries for frontend compatibility
    const transformedEntries = entries.map(entry => {
      const entryObj = entry.toObject();
      
      // For pitch-deck entries with stored file data, create download URL
      if (entryObj.entryType === 'pitch-deck' && entryObj.fileData) {
        entryObj.fileUrl = `/api/file/${entryObj.paymentIntentId}`;
      }
      
      // Remove base64 data from response to keep it lightweight
      delete entryObj.fileData;
      
      return entryObj;
    });
    
    console.log(`Found ${transformedEntries.length} entries for user:`, req.params.userId);
    res.json(transformedEntries);
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
    const entry = await Entry.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    const entryObj = entry.toObject();
    
    // For pitch-deck entries with stored file data, create download URL
    if (entryObj.entryType === 'pitch-deck' && entryObj.fileData) {
      entryObj.fileUrl = `/api/file/${entryObj.paymentIntentId}`;
    }
    
    // Remove base64 data from response
    delete entryObj.fileData;
    
    res.json(entryObj);
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
    
    const entry = await Entry.findById(entryId);
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    if (entry.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to delete this entry' });
    }
    
    // For serverless, files are stored in the database, so no file cleanup needed
    await Entry.findByIdAndDelete(entryId);
    console.log('Entry deleted successfully:', entryId);
    
    res.json({ message: 'Entry deleted successfully' });
  } catch (error) {
    console.error('Error deleting entry:', error);
    res.status(500).json({ 
      error: 'Failed to delete entry',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log(`Webhook signature verification failed.`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object;
    Entry.findOneAndUpdate(
      { paymentIntentId: paymentIntent.id },
      { paymentStatus: 'failed' }
    ).exec();
  }

  res.json({ received: true });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });
});

// CRITICAL: Export the app for Vercel
module.exports = app;

// Only listen on a port in development
const PORT = process.env.PORT || 5000;
if (!isVercelServerless) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log(`🧪 Create test entry: http://localhost:${PORT}/api/create-test-entry/user_test123`);
  });
}

