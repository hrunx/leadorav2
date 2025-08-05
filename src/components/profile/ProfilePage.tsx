import React, { useState, useEffect, useMemo } from 'react';
import { User, Building, Mail, Phone, MapPin, Briefcase, Save, Edit, Camera, Shield, Bell, CreditCard, Crown, CheckCircle, Clock, Calendar, TrendingUp } from 'lucide-react';
import { useProfile } from '../../hooks/useProfile';
import { useSubscription } from '../../hooks/useSubscription';
import { useAuth } from '../../context/AuthContext';

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';
const DEMO_USER_EMAIL = 'demo@leadora.com';

export default function ProfilePage() {
  const { state: authState } = useAuth();
  
  // Demo user detection
  const isDemoUser = (userId?: string | null, userEmail?: string | null) => {
    return userId === DEMO_USER_ID || userId === 'demo-user' || userEmail === DEMO_USER_EMAIL;
  };
  
  const isDemo = isDemoUser(authState.user?.id, authState.user?.email);

  // Only call hooks for real users to avoid auth errors
  const { profile, loading: profileLoading, error: profileError, updateProfile } = useProfile();
  const { subscription, loading: subLoading, isActive, isTrialing, currentPlan, planLimits, trialDaysLeft, daysUntilExpiry } = useSubscription();
  
  const [activeTab, setActiveTab] = useState('profile');

  // Demo subscription data for demo users
  const demoSubscription = {
    id: 'demo-sub',
    user_id: 'demo-user',
    provider: 'demo',
    plan: 'demo',
    status: 'active',
    period_start: '2024-01-01T00:00:00.000Z',
    period_end: '2024-12-31T23:59:59.000Z',
    trial_end: null,
    seats: 1,
    meta: {}
  };
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    full_name: '',
    company: '',
    country: '',
    phone: '',
  });

  // Use demo data for subscription if demo user
  const currentSubscription = useMemo(() => {
    return isDemo ? demoSubscription : subscription;
  }, [isDemo, subscription]);

  useEffect(() => {
    if (profile) {
      setFormData({
        full_name: profile.full_name || '',
        company: profile.company || '',
        country: profile.country || '',
        phone: profile.phone || '',
      });
    }
  }, [profile]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await updateProfile(formData);
      setIsEditing(false);
    } catch (err: any) {
      console.error('Failed to update profile:', err);
      setError(err.message || 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const getPlanColor = (plan: string) => {
    switch (plan) {
      case 'free': return 'text-gray-600 bg-gray-100';
      case 'starter': return 'text-blue-600 bg-blue-100';
      case 'pro': return 'text-purple-600 bg-purple-100';
      case 'enterprise': return 'text-yellow-600 bg-yellow-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getPlanFeatures = (plan: string) => {
    switch (plan) {
      case 'free':
        return ['3 searches/month', '10 businesses per search', '30 decision makers per search'];
      case 'starter':
        return ['25 searches/month', '50 businesses per search', '150 decision makers per search', 'Email campaigns', 'Market insights'];
      case 'pro':
        return ['100 searches/month', '200 businesses per search', '600 decision makers per search', 'API access', 'Priority support'];
      case 'enterprise':
        return ['Unlimited searches', '500 businesses per search', '1500 decision makers per search', 'Custom integrations', 'Dedicated support'];
      default:
        return [];
    }
  };

  if (profileLoading || subLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Profile</h2>
          <p className="text-gray-600">{profileError}</p>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'subscription', label: 'Subscription', icon: CreditCard },
    { id: 'preferences', label: 'Preferences', icon: Shield },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Account Settings</h1>
          <p className="text-gray-600 mt-2">Manage your profile, subscription, and preferences</p>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center space-x-2 py-4 border-b-2 font-medium text-sm ${
                      activeTab === tab.id
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'profile' && (
              <div className="space-y-6">
                {/* Profile Header */}
                <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-6">
                  <div className="flex items-center space-x-4">
                    <div className="relative">
                      <div className="w-20 h-20 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center">
                        <User className="w-10 h-10 text-white" />
                      </div>
                      <button className="absolute -bottom-1 -right-1 w-6 h-6 bg-white rounded-full shadow-sm border border-gray-200 flex items-center justify-center hover:bg-gray-50">
                        <Camera className="w-3 h-3 text-gray-500" />
                      </button>
                    </div>
                    <div className="flex-1">
                      <h2 className="text-xl font-semibold text-gray-900">
                        {profile?.full_name || 'User Profile'}
                      </h2>
                      <p className="text-gray-600">{profile?.email}</p>
                      <p className="text-sm text-gray-500">{profile?.company}</p>
                      <div className="flex items-center space-x-2 mt-2">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getPlanColor(currentPlan)}`}>
                          <Crown className="w-3 h-3 mr-1" />
                          {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} Plan
                        </span>
                        {isTrialing && trialDaysLeft && trialDaysLeft > 0 && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-orange-600 bg-orange-100">
                            <Clock className="w-3 h-3 mr-1" />
                            {trialDaysLeft} days left
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setIsEditing(!isEditing)}
                      className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                      <Edit className="w-4 h-4" />
                      <span>{isEditing ? 'Cancel' : 'Edit Profile'}</span>
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="text-red-800 text-sm">{error}</p>
                  </div>
                )}

                {/* Personal Information */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Personal Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                      {isEditing ? (
                        <input
                          type="text"
                          name="full_name"
                          value={formData.full_name}
                          onChange={handleChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="John Doe"
                        />
                      ) : (
                        <p className="text-gray-900">{profile?.full_name || 'Not set'}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <p className="text-gray-900">{profile?.email}</p>
                      <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                      {isEditing ? (
                        <input
                          type="text"
                          name="company"
                          value={formData.company}
                          onChange={handleChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Your Company Name"
                        />
                      ) : (
                        <p className="text-gray-900">{profile?.company || 'Not set'}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                      {isEditing ? (
                        <input
                          type="tel"
                          name="phone"
                          value={formData.phone}
                          onChange={handleChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="+1 (555) 123-4567"
                        />
                      ) : (
                        <p className="text-gray-900">{profile?.phone || 'Not set'}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                      {isEditing ? (
                        <input
                          type="text"
                          name="country"
                          value={formData.country}
                          onChange={handleChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="United States"
                        />
                      ) : (
                        <p className="text-gray-900">{profile?.country || 'Not set'}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Member Since</label>
                      <p className="text-gray-900">
                        {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : 'Unknown'}
                      </p>
                    </div>
                  </div>

                  {isEditing && (
                    <div className="mt-6 pt-4 border-t border-gray-200">
                      <div className="flex space-x-3">
                        <button
                          onClick={handleSave}
                          disabled={isSaving}
                          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                          {isSaving ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Save className="w-4 h-4" />
                          )}
                          <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
                        </button>
                        <button
                          onClick={() => setIsEditing(false)}
                          className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'subscription' && (
              <div className="space-y-6">
                {/* Current Plan */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Current Plan</h3>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <div className={`p-3 rounded-lg ${getPlanColor(currentPlan).replace('text-', 'bg-').replace('bg-gray-100', 'bg-gray-200')}`}>
                        <Crown className={`w-6 h-6 ${getPlanColor(currentPlan).split(' ')[0]}`} />
                      </div>
                      <div>
                        <h4 className="text-xl font-semibold text-gray-900">
                          {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} Plan
                        </h4>
                        <p className="text-gray-600">
                          {isTrialing ? `Trial period - ${trialDaysLeft} days left` : 
                           isActive ? 'Active subscription' : 'Inactive'}
                        </p>
                      </div>
                    </div>
                    <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                      Upgrade Plan
                    </button>
                  </div>

                  {/* Plan Features */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    {getPlanFeatures(currentPlan).map((feature, index) => (
                      <div key={index} className="flex items-center space-x-2">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span className="text-sm text-gray-700">{feature}</span>
                      </div>
                    ))}
                  </div>

                  {/* Subscription Details */}
                  {subscription && (
                    <div className="border-t border-gray-200 pt-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-gray-500">Status:</span>
                          <p className="font-medium">{subscription.status}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Provider:</span>
                          <p className="font-medium">{subscription.provider}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Seats:</span>
                          <p className="font-medium">{subscription.seats}</p>
                        </div>
                        {subscription.period_end && (
                          <div>
                            <span className="text-gray-500">Next billing:</span>
                            <p className="font-medium">{new Date(subscription.period_end).toLocaleDateString()}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Usage Stats */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Usage This Month</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-blue-50 rounded-lg">
                      <TrendingUp className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                      <p className="text-2xl font-bold text-blue-600">0</p>
                      <p className="text-sm text-gray-600">Searches Used</p>
                      <p className="text-xs text-gray-500">
                        of {planLimits.searches_per_month === -1 ? 'unlimited' : planLimits.searches_per_month}
                      </p>
                    </div>
                    <div className="text-center p-4 bg-purple-50 rounded-lg">
                      <Building className="w-8 h-8 text-purple-600 mx-auto mb-2" />
                      <p className="text-2xl font-bold text-purple-600">0</p>
                      <p className="text-sm text-gray-600">Businesses Found</p>
                    </div>
                    <div className="text-center p-4 bg-green-50 rounded-lg">
                      <User className="w-8 h-8 text-green-600 mx-auto mb-2" />
                      <p className="text-2xl font-bold text-green-600">0</p>
                      <p className="text-sm text-gray-600">Decision Makers</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'preferences' && (
              <div className="space-y-6">
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Account Preferences</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-medium text-gray-900">Email Notifications</h4>
                        <p className="text-sm text-gray-500">Receive email updates about your searches</p>
                      </div>
                      <button className="relative inline-flex h-6 w-11 items-center rounded-full bg-blue-600">
                        <span className="inline-block h-4 w-4 transform rounded-full bg-white transition translate-x-6" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-medium text-gray-900">Marketing Emails</h4>
                        <p className="text-sm text-gray-500">Receive product updates and tips</p>
                      </div>
                      <button className="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-200">
                        <span className="inline-block h-4 w-4 transform rounded-full bg-white transition translate-x-1" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}