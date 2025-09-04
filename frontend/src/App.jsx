import React, { useState, useEffect } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import EntryForm from './components/EntryForm';
import EntryList from './components/EntryList';
import './App.css';

// Initialize Stripe with the publishable key
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

// Use the correct backend URL - updated to match your provided URL
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://alatree-ventures-assignments-lime.vercel.app';

function App() {
  const [currentView, setCurrentView] = useState('submit');
  const [userId] = useState(() => {
    let storedUserId = localStorage.getItem('top216_user_id');
    if (!storedUserId) {
      storedUserId = 'user_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
      localStorage.setItem('top216_user_id', storedUserId);
    }
    return storedUserId;
  });

  useEffect(() => {
    console.log('=== App Initialization ===');
    console.log('User ID:', userId);
    console.log('API_BASE_URL:', API_BASE_URL);
    console.log('VITE_API_URL:', import.meta.env.VITE_API_URL || 'Not set - using production default');
    console.log('VITE_STRIPE_PUBLISHABLE_KEY:', import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ? 'Set' : 'Not set');
    
    // Test backend connectivity
    testBackendConnection();
  }, [userId]);

  const testBackendConnection = async () => {
    try {
      console.log('Testing backend connection to:', API_BASE_URL);
      const response = await fetch(`${API_BASE_URL}/api/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (response.ok) {
        const data = await response.json();
        console.log('✅ Backend connection successful:', data);
      } else {
        console.warn('⚠️ Backend responded with status:', response.status);
      }
    } catch (error) {
      console.error('❌ Backend connection failed:', error);
      console.log('💡 Tip: Make sure your backend is deployed and running at:', API_BASE_URL);
    }
  };

  const handleCreateTestEntry = async () => {
    try {
      console.log('Creating test entry via:', `${API_BASE_URL}/api/create-test-entry/${userId}`);
      const response = await fetch(`${API_BASE_URL}/api/create-test-entry/${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json();
      if (response.ok) {
        alert(`Test entry created successfully! Entry ID: ${data.id}`);
        if (currentView === 'entries') {
          window.location.reload();
        } else {
          setCurrentView('entries');
        }
      } else {
        alert('Failed to create test entry: ' + data.error);
      }
    } catch (error) {
      console.error('Error creating test entry:', error);
      alert('Failed to create test entry. Please check console for details.');
    }
  };

  const handleCreateMultipleTestEntries = async () => {
    try {
      console.log('Creating multiple test entries via:', `${API_BASE_URL}/api/create-test-entries/${userId}`);
      const response = await fetch(`${API_BASE_URL}/api/create-test-entries/${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json();
      if (response.ok) {
        alert(`${data.entries.length} test entries created successfully!`);
        if (currentView === 'entries') {
          window.location.reload();
        } else {
          setCurrentView('entries');
        }
      } else {
        alert('Failed to create test entries: ' + data.error);
      }
    } catch (error) {
      console.error('Error creating test entries:', error);
      alert('Failed to create test entries. Please check console for details.');
    }
  };

  return (
    <Elements stripe={stripePromise}>
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
                  <p className="text-xs">Production Environment</p>
                  <p className="text-xs">API: {API_BASE_URL.includes('vercel') ? 'Production' : 'Local'}</p>
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
                  
                </div>
              </nav>
            </div>
          </header>
         
          <main className="max-w-4xl mx-auto px-4 py-8">
            {currentView === 'submit' ? (
              <>
                <div className="mb-6 text-white text-2xl font-semibold">
                  Welcome to<span className='text-yellow-300'> Top216.com </span> - A global competition platform
                </div>
                <EntryForm userId={userId} />
              </>
            ) : (
              <EntryList userId={userId} />
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
                    <li>🌐 Backend: {API_BASE_URL.includes('vercel') ? 'Production' : 'Development'}</li>
                  </ul>
                </div>
              </div>
              <div className="mt-8 pt-8 border-t text-center text-sm text-white">
                <p>&copy; 2025 Top216.com - Global Competition Platform</p>
                <p className="mt-2 text-xs text-gray-400">
                  API Endpoint: {API_BASE_URL}
                </p>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </Elements>
  );
}

export default App;
