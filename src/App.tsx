import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/dashboard/Dashboard';
import SearchSelection from './components/modules/SearchSelection';
import BusinessPersonas from './components/modules/BusinessPersonas';
import BusinessResults from './components/modules/BusinessResults';
import DecisionMakerPersonas from './components/modules/DecisionMakerPersonas';
import DecisionMakerMapping from './components/modules/DecisionMakerMapping';
import MarketingInsights from './components/modules/MarketingInsights';
import CampaignManagement from './components/modules/CampaignManagement';
import LandingPage from './components/landing/LandingPage';
import LoginPage from './components/auth/LoginPage';
import RegisterPage from './components/auth/RegisterPage';
import ProfilePage from './components/profile/ProfilePage';
import OnboardingTour from './components/OnboardingTour';
import BackgroundProgressBar from './components/BackgroundProgressBar';
import { AuthProvider, useAuth } from './context/AuthContext';
import { UserDataProvider, useUserData } from './context/UserDataContext';
import { AppProvider, useAppContext } from './context/AppContext';

import { DEMO_USER_ID, DEMO_USER_EMAIL, isDemoUser } from './constants/demo';

function AppContent() {
  const { state: authState, login } = useAuth();
  const { getSearch, setCurrentSearch } = useUserData();
  const { updateSearchData } = useAppContext();
  const [activeModule, setActiveModule] = useState('dashboard');
  const [showLanding, setShowLanding] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [currentSearchId, setCurrentSearchId] = useState<string | null>(null);
  const [showBackgroundProgress, setShowBackgroundProgress] = useState(false);

  // Simple demo user detection
  const isDemoUser = (userId?: string | null, userEmail?: string | null) => {
    return userId === DEMO_USER_ID || userId === 'demo-user' || userEmail === DEMO_USER_EMAIL;
  };

  // Check if user should see onboarding
  useEffect(() => {
    if (authState.isAuthenticated && authState.user) {
      const hasSeenOnboarding = localStorage.getItem(`onboarding_${authState.user.id}`);
      if (!hasSeenOnboarding) {
        setShowOnboarding(true);
      }
    }
  }, [authState.isAuthenticated, authState.user]);

  // Listen for background progress events
  useEffect(() => {
    const handleStartBackgroundProgress = (event: any) => {
      if (event.detail?.searchId) {
        setCurrentSearchId(event.detail.searchId);
        setShowBackgroundProgress(true);
      }
    };

    window.addEventListener('startBackgroundProgress', handleStartBackgroundProgress);
    return () => window.removeEventListener('startBackgroundProgress', handleStartBackgroundProgress);
  }, []);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    if (authState.user) {
      localStorage.setItem(`onboarding_${authState.user.id}`, 'true');
    }
  };

  // Listen for navigation events from modules
  useEffect(() => {
    const handleNavigation = (event: any) => {
      setActiveModule(event.detail);
    };
    
    window.addEventListener('navigate', handleNavigation);
    return () => window.removeEventListener('navigate', handleNavigation);
  }, []);

  const handleStartNewSearch = () => {
    setCurrentSearchId(null);
    setCurrentSearch(''); // Clear current search in context
    setActiveModule('search');
  };

  const handleViewSearch = (searchId: string) => {
    const search = getSearch(searchId);
    if (!search) return;
    // Select existing search only; do NOT create a new one
    setCurrentSearchId(searchId);
    setCurrentSearch(searchId);
    updateSearchData({
      type: search.search_type,
      productService: search.product_service,
      industries: search.industries || [],
      countries: search.countries || [],
      timestamp: search.created_at
    });
    // Show personas screen; data hooks will load existing rows for this search
    setActiveModule('personas');
  };

  const handleCreateCampaign = () => {
    setActiveModule('campaigns');
  };

  const handleGetStarted = () => {
    setShowLanding(false);
    setAuthMode('register');
  };

  const handleSignIn = () => {
    setShowLanding(false);
    setAuthMode('login');
  };

  const handleViewDemo = () => {
    setShowLanding(false);
    // Auto-login with demo credentials
    login('demo@leadora.com', 'demo123');
  };

  const renderActiveModule = () => {
    switch (activeModule) {
      case 'dashboard':
        return (
          <Dashboard 
            onStartNewSearch={handleStartNewSearch}
            onViewSearch={handleViewSearch}
            onCreateCampaign={handleCreateCampaign}
          />
        );
      case 'search':
        return <SearchSelection />;
      case 'personas':
        return <BusinessPersonas />;
      case 'results':
        return <BusinessResults />;
      case 'decision-maker-profiles':
        return <DecisionMakerPersonas />;
      case 'decision-makers': 
        return <DecisionMakerMapping />;
      case 'insights':
        return <MarketingInsights />;
      case 'campaigns':
        return <CampaignManagement />;
      case 'profile':
        return <ProfilePage />;
      default:
        return (
          <Dashboard 
            onStartNewSearch={handleStartNewSearch}
            onViewSearch={handleViewSearch}
            onCreateCampaign={handleCreateCampaign}
          />
        );
    }
  };

  // Show loading screen while checking authentication
  if (authState.isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h3 className="text-lg font-semibold text-gray-900">Loading...</h3>
        </div>
      </div>
    );
  }

  // Show authentication pages if not logged in
  if (!authState.isAuthenticated) {
    // Show landing page first
    if (showLanding) {
      return <LandingPage onGetStarted={handleGetStarted} onSignIn={handleSignIn} onViewDemo={handleViewDemo} />;
    }
    
    return (
      <>
        {authMode === 'login' ? (
          <LoginPage 
            onSwitchToRegister={() => setAuthMode('register')} 
            onBackToLanding={() => setShowLanding(true)}
          />
        ) : (
          <RegisterPage 
            onSwitchToLogin={() => setAuthMode('login')} 
            onBackToLanding={() => setShowLanding(true)}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50" role="application" aria-label="Leadora Platform">
      {showOnboarding && (
        <div role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
          <OnboardingTour onComplete={handleOnboardingComplete} />
        </div>
      )}
      
      <nav role="navigation" aria-label="Main navigation" className="flex-shrink-0">
        <Sidebar 
          activeModule={activeModule} 
          setActiveModule={setActiveModule} 
        />
      </nav>
      
      <main role="main" className="flex-1 overflow-auto" aria-label="Main content area">
        {/* Demo Mode Banner */}
        {isDemoUser(authState.user?.id, authState.user?.email) && (
          <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-6 py-3">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-6 h-6 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
                  <span className="text-xs font-bold">!</span>
                </div>
                <span className="font-medium">Demo Mode - Subscribe to access real lead generation and market intelligence</span>
              </div>
              <button className="bg-white text-orange-600 px-4 py-2 rounded-lg font-medium hover:bg-gray-100 transition-colors">
                Subscribe Now
              </button>
            </div>
          </div>
        )}
        <div className="max-w-7xl mx-auto px-6 py-8">
          {renderActiveModule()}
        </div>

        {/* Background Progress Bar */}
        <BackgroundProgressBar
          searchId={currentSearchId || ''}
          isVisible={showBackgroundProgress && !!currentSearchId}
          onComplete={() => setShowBackgroundProgress(false)}
        />
      </main>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <UserDataProvider>
        <AppProvider>
          <AppContent />
        </AppProvider>
      </UserDataProvider>
    </AuthProvider>
  );
}

export default App;