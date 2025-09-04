import React, { useState, useEffect } from 'react';

// For demo purposes - in real app you'd use actual Stripe components
const CardElement = ({ options }) => (
  <div className="p-3 border border-gray-300 rounded-md bg-gray-50">
    <div className="text-sm text-gray-600">💳 Test Card Information</div>
    <div className="text-xs text-gray-500 mt-1">
      <div>Card: 4242 4242 4242 4242</div>
      <div>Expiry: 12/28 | CVC: 123 | ZIP: 10001</div>
    </div>
  </div>
);

// Use your deployed backend URL
const API_BASE_URL = 'https://alatree-ventures-assignments-cj6v-o64r0h82b-ovezes-projects.vercel.app';

const EntryForm = ({ userId, onEntrySubmitted }) => {
  const [formData, setFormData] = useState({
    category: '',
    entryType: '',
    title: '',
    description: '',
    textContent: '',
    videoUrl: '',
    file: null
  });
  const [fees, setFees] = useState({
    entryFee: 0,
    stripeFee: 0,
    totalAmount: 0
  });
  const [clientSecret, setClientSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [step, setStep] = useState(1);

  const categories = [
    { value: 'business', label: 'Business', fee: 49 },
    { value: 'creative', label: 'Creative', fee: 49 },
    { value: 'technology', label: 'Technology', fee: 99 },
    { value: 'social-impact', label: 'Social Impact', fee: 49 }
  ];

  const entryTypes = [
    { value: 'text', label: 'Text Entry (100-2000 words)' },
    { value: 'pitch-deck', label: 'Pitch Deck (PDF/PPT, max 25MB)' },
    { value: 'video', label: 'Video (YouTube/Vimeo link)' }
  ];

  const handleCategoryChange = async (category) => {
    setFormData(prev => ({ ...prev, category }));
    if (category && formData.entryType) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/create-payment-intent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category, entryType: formData.entryType }),
        });
        if (!response.ok) {
          throw new Error('Failed to calculate fees');
        }
        const data = await response.json();
        setFees({ entryFee: data.entryFee, stripeFee: data.stripeFee, totalAmount: data.totalAmount });
        setClientSecret(data.clientSecret);
      } catch (err) {
        setError('Failed to calculate fees: ' + err.message);
      }
    }
  };

  const handleInputChange = (e) => {
    const { name, value, files } = e.target;
    if (name === 'file') {
      setFormData(prev => ({ ...prev, file: files[0] }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
    if (name === 'category') {
      handleCategoryChange(value);
    } else if (name === 'entryType' && formData.category) {
      handleCategoryChange(formData.category);
    }
  };

  const validateForm = () => {
    const { category, entryType, title, textContent, videoUrl, file } = formData;
    if (!category || !entryType || !title.trim()) {
      setError('Please fill in all required fields');
      return false;
    }
    if (title.length < 5 || title.length > 100) {
      setError('Title must be between 5-100 characters');
      return false;
    }
    if (entryType === 'text') {
      if (!textContent.trim()) {
        setError('Text content is required for text entries');
        return false;
      }
      const wordCount = textContent.trim().split(/\s+/).filter(word => word.length > 0).length;
      if (wordCount < 100 || wordCount > 2000) {
        setError(`Text entries must be between 100-2000 words. Current: ${wordCount} words`);
        return false;
      }
    }
    if (entryType === 'pitch-deck' && !file) {
      setError('Please upload a pitch deck file');
      return false;
    }
    if (entryType === 'pitch-deck' && file) {
      const maxSize = 25 * 1024 * 1024;
      if (file.size > maxSize) {
        setError('File size must be less than 25MB');
        return false;
      }
      const allowedTypes = ['application/pdf', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'];
      if (!allowedTypes.includes(file.type)) {
        setError('Only PDF, PPT, and PPTX files are allowed');
        return false;
      }
    }
    if (entryType === 'video') {
      if (!videoUrl.trim()) {
        setError('Video URL is required for video entries');
        return false;
      }
      const urlPattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|vimeo\.com)/i;
      if (!urlPattern.test(videoUrl)) {
        setError('Please provide a valid YouTube or Vimeo URL');
        return false;
      }
    }
    return true;
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/create-payment-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: formData.category, entryType: formData.entryType }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create payment intent');
      }
      const data = await response.json();
      setFees({ entryFee: data.entryFee, stripeFee: data.stripeFee, totalAmount: data.totalAmount });
      setClientSecret(data.clientSecret);
      setStep(2);
    } catch (err) {
      setError('Failed to initialize payment: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    
    setLoading(true);
    setError('');
    
    // Mock payment success for demo
    const mockPaymentIntent = { id: 'pi_mock_' + Date.now() };
    
    try {
      const submitData = new FormData();
      submitData.append('userId', userId);
      submitData.append('category', formData.category);
      submitData.append('entryType', formData.entryType);
      submitData.append('title', formData.title);
      submitData.append('description', formData.description);
      submitData.append('paymentIntentId', mockPaymentIntent.id);
      
      if (formData.entryType === 'text') {
        submitData.append('textContent', formData.textContent);
      } else if (formData.entryType === 'pitch-deck' && formData.file) {
        submitData.append('file', formData.file);
      } else if (formData.entryType === 'video') {
        submitData.append('videoUrl', formData.videoUrl);
      }
      
      const response = await fetch(`${API_BASE_URL}/api/entries`, {
        method: 'POST',
        body: submitData,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit entry');
      }
      
      const data = await response.json();
      setSuccess('Entry submitted successfully! Entry ID: ' + data.entryId);
      
      // Reset form
      setFormData({
        category: '',
        entryType: '',
        title: '',
        description: '',
        textContent: '',
        videoUrl: '',
        file: null
      });
      setFees({ entryFee: 0, stripeFee: 0, totalAmount: 0 });
      setClientSecret('');
      setStep(1);
      
      // Notify parent component
      if (onEntrySubmitted) {
        onEntrySubmitted();
      }
    } catch (err) {
      setError('Failed to submit entry: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-8">
      {success && (
        <div className="mb-6 p-4 bg-green-100 text-green-700 rounded-md">
          {success}
          <button
            onClick={() => setSuccess('')}
            className="ml-4 text-sm text-green-900 underline"
          >
            Close
          </button>
        </div>
      )}
      
      {error && (
        <div className="mb-6 p-4 bg-red-100 text-red-700 rounded-md">
          {error}
          <button
            onClick={() => setError('')}
            className="ml-4 text-sm text-red-900 underline"
          >
            Close
          </button>
        </div>
      )}

      {step === 1 && (
        <form onSubmit={handleFormSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Category *</label>
            <select
              name="category"
              value={formData.category}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              required
            >
              <option value="">Select a category</option>
              {categories.map(cat => (
                <option key={cat.value} value={cat.value}>{cat.label} (${cat.fee})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Entry Type *</label>
            <select
              name="entryType"
              value={formData.entryType}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              required
            >
              <option value="">Select an entry type</option>
              {entryTypes.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Title *</label>
            <input
              type="text"
              name="title"
              value={formData.title}
              onChange={handleInputChange}
              placeholder="Enter your entry title"
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              required
            />
            <p className="mt-1 text-xs text-gray-500">{formData.title.length}/100 characters</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              placeholder="Enter a brief description (optional, max 500 characters)"
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">{formData.description.length}/500 characters</p>
          </div>

          {formData.entryType === 'text' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Text Content *</label>
              <textarea
                name="textContent"
                value={formData.textContent}
                onChange={handleInputChange}
                placeholder="Enter your text content here (100-2000 words)"
                rows={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                required
              />
              {formData.textContent && (
                <p className="mt-1 text-xs text-gray-500">
                  Word count: {formData.textContent.trim().split(/\s+/).filter(word => word.length > 0).length} words
                </p>
              )}
            </div>
          )}

          {formData.entryType === 'pitch-deck' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Upload Pitch Deck *</label>
              <input
                type="file"
                name="file"
                onChange={handleInputChange}
                accept=".pdf,.ppt,.pptx"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                required
              />
              <p className="mt-1 text-xs text-gray-500">Accepted formats: PDF, PPT, PPTX (max 25MB)</p>
            </div>
          )}

          {formData.entryType === 'video' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Video URL *</label>
              <input
                type="url"
                name="videoUrl"
                value={formData.videoUrl}
                onChange={handleInputChange}
                placeholder="https://youtube.com/watch?v=... or https://vimeo.com/..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                required
              />
              <p className="mt-1 text-xs text-gray-500">YouTube and Vimeo links only</p>
            </div>
          )}

          {fees.totalAmount > 0 && (
            <div className="bg-gray-50 rounded-md p-4">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Fee Summary</h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Entry Fee:</span>
                  <span>${fees.entryFee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Processing Fee:</span>
                  <span>${fees.stripeFee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-medium pt-1 border-t">
                  <span>Total:</span>
                  <span>${fees.totalAmount.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-4">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && (
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {loading ? 'Processing...' : 'Continue to Payment'}
            </button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={handlePaymentSubmit} className="space-y-6">
          <div className="bg-gray-50 rounded-md p-4 mb-6">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Entry Summary</h3>
            <div className="space-y-1 text-sm">
              <div><span className="font-medium">Category:</span> {categories.find(c => c.value === formData.category)?.label}</div>
              <div><span className="font-medium">Type:</span> {entryTypes.find(t => t.value === formData.entryType)?.label}</div>
              <div><span className="font-medium">Title:</span> {formData.title}</div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Card Information</label>
            <CardElement />
            <div className="text-sm text-gray-500 mt-2">
              <p>Use test card: 4242 4242 4242 4242</p>
              <p>Expiry: 12/28 | CVC: 123 | ZIP: 10001</p>
              <p className="text-xs mt-1">For test payments only.</p>
            </div>
          </div>

          <div className="bg-gray-50 rounded-md p-4">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Payment Summary</h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Entry Fee:</span>
                <span>${fees.entryFee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Processing Fee:</span>
                <span>${fees.stripeFee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-medium text-lg pt-2 border-t">
                <span>Total:</span>
                <span>${fees.totalAmount.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Back to Entry Details
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && (
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {loading ? 'Processing Payment...' : `Pay $${fees.totalAmount.toFixed(2)}`}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

const EntryList = ({ userId, refreshTrigger }) => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchEntries();
  }, [userId, refreshTrigger]);

  const fetchEntries = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/entries/${userId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch entries');
      }
      const data = await response.json();
      setEntries(data);
      setError('');
    } catch (error) {
      console.error('Error fetching entries:', error);
      setError('Failed to load entries. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEntry = async (entryId) => {
    if (!window.confirm('Are you sure you want to delete this entry? This action cannot be undone.')) {
      return;
    }
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/entries/${entryId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete entry');
      }
      setEntries(entries.filter(entry => entry._id !== entryId));
      setError('');
    } catch (error) {
      console.error('Error deleting entry:', error);
      setError('Failed to delete entry: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      'submitted': 'bg-blue-100 text-blue-800',
      'under-review': 'bg-yellow-100 text-yellow-800',
      'finalist': 'bg-green-100 text-green-800',
      'winner': 'bg-purple-100 text-purple-800',
      'rejected': 'bg-red-100 text-red-800'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const EntryModal = ({ entry, onClose }) => {
    if (!entry) return null;
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-4xl max-h-screen overflow-y-auto w-full">
          <div className="p-6">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-2xl font-bold text-gray-900">{entry.title}</h2>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none"
              >
                ×
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 text-sm">
              <div>
                <span className="font-medium text-gray-700">Category:</span>
                <span className="ml-2 capitalize">{entry.category.replace('-', ' ')}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Type:</span>
                <span className="ml-2 capitalize">{entry.entryType.replace('-', ' ')}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Status:</span>
                <span className={`ml-2 px-2 py-1 rounded-full text-xs ${getStatusColor(entry.status)}`}>
                  {entry.status.replace('-', ' ')}
                </span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Submitted:</span>
                <span className="ml-2">{formatDate(entry.submissionDate)}</span>
              </div>
            </div>
            {entry.description && (
              <div className="mb-4">
                <h3 className="font-medium text-gray-700 mb-2">Description</h3>
                <p className="text-gray-600 bg-gray-50 p-3 rounded-md">{entry.description}</p>
              </div>
            )}
            {entry.entryType === 'text' && entry.textContent && (
              <div className="mb-4">
                <h3 className="font-medium text-gray-700 mb-2">Content</h3>
                <div className="bg-gray-50 p-4 rounded-md max-h-96 overflow-y-auto">
                  <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans">{entry.textContent}</pre>
                </div>
              </div>
            )}
            <div className="bg-gray-50 p-4 rounded-md border">
              <h3 className="font-medium text-gray-700 mb-2">Payment Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Entry Fee:</span>
                  <span className="ml-2 font-medium">${entry.entryFee?.toFixed(2) || '0.00'}</span>
                </div>
                <div>
                  <span className="text-gray-600">Processing Fee:</span>
                  <span className="ml-2 font-medium">${entry.stripeFee?.toFixed(2) || '0.00'}</span>
                </div>
                <div>
                  <span className="text-gray-600">Total Paid:</span>
                  <span className="ml-2 font-medium text-green-600">${entry.totalAmount?.toFixed(2) || '0.00'}</span>
                </div>
                <div>
                  <span className="text-gray-600">Payment Status:</span>
                  <span className={`ml-2 px-2 py-1 rounded-full text-xs ${
                    entry.paymentStatus === 'succeeded' ? 'bg-green-100 text-green-800' : 
                    entry.paymentStatus === 'failed' ? 'bg-red-100 text-red-800' : 
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {entry.paymentStatus}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your entries...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8">
        <div className="text-center">
          <div className="text-red-600 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 18.5c-.77.833.192 2.5 1.732 2.5z"></path>
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Error Loading Entries</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={fetchEntries}
            className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8">
        <div className="text-center">
          <div className="text-gray-400 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">No Entries Yet</h2>
          <p className="text-gray-600 mb-6">You haven't submitted any entries to Top216.com competitions.</p>
          <p className="text-gray-500">Submit your first entry to get started!</p>
          <div className="mt-6">
            <p className="text-sm text-blue-600">
              Tip: Try creating a test entry using Stripe test card: 4242 4242 4242 4242
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-lg shadow-md p-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">My Entries ({entries.length})</h2>
          <button
            onClick={fetchEntries}
            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
          >
            Refresh
          </button>
        </div>
        <div className="space-y-4">
          {entries.map((entry) => (
            <div
              key={entry._id}
              className="border border-gray-200 rounded-lg p-6 hover:shadow-md hover:border-blue-300 transition-all cursor-pointer"
              onClick={() => setSelectedEntry(entry)}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{entry.title}</h3>
                  <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                    <span className="capitalize">{entry.category.replace('-', ' ')}</span>
                    <span>•</span>
                    <span className="capitalize">{entry.entryType.replace('-', ' ')}</span>
                    <span>•</span>
                    <span>{formatDate(entry.submissionDate)}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(entry.status)}`}>
                    {entry.status.replace('-', ' ')}
                  </span>
                  <span className="text-sm font-medium text-green-600">${entry.totalAmount?.toFixed(2) || '0.00'}</span>
                </div>
              </div>
              {entry.description && (
                <p className="text-gray-600 text-sm mb-4 line-clamp-2">{entry.description}</p>
              )}
              <div className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-4">
                  {entry.entryType === 'text' && (
                    <span className="text-gray-500">
                      {entry.textContent ? `${entry.textContent.split(/\s+/).filter(word => word.length > 0).length} words` : 'No content'}
                    </span>
                  )}
                  {entry.entryType === 'pitch-deck' && (
                    <span className="text-blue-600">File uploaded</span>
                  )}
                  {entry.entryType === 'video' && (
                    <span className="text-red-600">Video linked</span>
                  )}
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    entry.paymentStatus === 'succeeded' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {entry.paymentStatus}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-blue-600 hover:text-blue-800 font-medium flex items-center">
                    View Details →
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteEntry(entry._id);
                    }}
                    className="text-red-600 hover:text-red-800 font-medium flex items-center"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <EntryModal entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
    </>
  );
};

const App = () => {
  const [currentView, setCurrentView] = useState('submit');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  // Generate a userId using React state instead of localStorage
  const [userId] = useState(() => {
    return 'user_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
  });

  const handleCreateTestEntry = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/create-test-entry/${userId}`);
      const data = await response.json();
      if (response.ok) {
        alert(`Test entry created successfully! Entry ID: ${data.id}`);
        setRefreshTrigger(prev => prev + 1);
        if (currentView !== 'entries') {
          setCurrentView('entries');
        }
      } else {
        alert('Failed to create test entry: ' + data.error);
      }
    } catch (error) {
      console.error('Error creating test entry:', error);
      alert('Failed to create test entry');
    }
  };

  const handleCreateMultipleTestEntries = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/create-test-entries/${userId}`);
      const data = await response.json();
      if (response.ok) {
        alert(`${data.entries.length} test entries created successfully!`);
        setRefreshTrigger(prev => prev + 1);
        if (currentView !== 'entries') {
          setCurrentView('entries');
        }
      } else {
        alert('Failed to create test entries: ' + data.error);
      }
    } catch (error) {
      console.error('Error creating test entries:', error);
      alert('Failed to create test entries');
    }
  };

  const handleEntrySubmitted = () => {
    setRefreshTrigger(prev => prev + 1);
    setCurrentView('entries');
  };

  return (
    <div className='overflow-hidden bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-800'>
      <div className="min-h-screen overflow-hidden bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-800">
        <header className="overflow-hidden bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-800 shadow-sm text-white">
          <div className="max-w-4xl mx-auto px-4 py-6">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-5xl md:text-6xl font-bold mb-4 tracking-tight text-yellow-300">Top216.com</h1>
                <p className="text-white mt-2">Global competition platform for professionals and creators submit entries across categories</p>
              </div>
              <div className="text-right text-sm text-white">
                <p>User ID: {userId.substring(0, 12)}...</p>
                <p className="text-xs">Test Environment</p>
              </div>
            </div>
            <nav className="mt-6">
              <div className="flex flex-wrap items-center justify-between">
                <div className="flex space-x-4">
                  <button
                    onClick={() => setCurrentView('submit')}
                    className={`px-4 py-2 rounded-md font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                      currentView === 'submit' 
                        ? 'bg-blue-600 text-white' 
                        : 'text-white hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    Submit Entry
                  </button>
                  <button
                    onClick={() => setCurrentView('entries')}
                    className={`px-4 py-2 rounded-md font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                      currentView === 'entries' 
                        ? 'bg-blue-600 text-white' 
                        : 'text-white hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    My Entries
                  </button>
                </div>
                <div className="flex space-x-2 mt-4 md:mt-0">
                  <button
                    onClick={handleCreateTestEntry}
                    className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    Create Test Entry
                  </button>
                  <button
                    onClick={handleCreateMultipleTestEntries}
                    className="px-3 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
                  >
                    Create Multiple
                  </button>
                </div>
              </div>
            </nav>
          </div>
        </header>
       
        <main className="max-w-4xl mx-auto px-4 py-8">
          {currentView === 'submit' ? (
            <>
              <div className="mb-6 text-white text-2xl font-semibold">
                Welcome to <span className='text-yellow-300'>Top216.com</span> - A global competition platform
              </div>
              <EntryForm userId={userId} onEntrySubmitted={handleEntrySubmitted} />
            </>
          ) : (
            <EntryList userId={userId} refreshTrigger={refreshTrigger} />
          )}
        </main>
        
        <footer className="bg-black border-t mt-16">
          <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div>
                <h4 className="font-semibold text-white mb-2">Competition Categories</h4>
                <ul className="text-sm text-white space-y-1">
                  <li>• Business - $49</li>
                  <li>• Creative - $49</li>
                  <li>• Technology - $99</li>
                  <li>• Social Impact - $49</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-white mb-2">Entry Types</h4>
                <ul className="text-sm text-white space-y-1">
                  <li>• Text (100-2000 words)</li>
                  <li>• Pitch Deck (PDF/PPT, max 25MB)</li>
                  <li>• Video (YouTube/Vimeo link)</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-white mb-2">System Status</h4>
                <ul className="text-sm text-white space-y-1">
                  <li>✅ MongoDB Connected</li>
                  <li>✅ Stripe Test Mode</li>
                  <li>✅ File Upload Ready</li>
                  <li>✅ Payment Processing</li>
                </ul>
              </div>
            </div>
            <div className="mt-8 pt-8 border-t text-center text-sm text-white">
              <p>&copy; 2025 Top216.com - Global Competition Platform</p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default App
