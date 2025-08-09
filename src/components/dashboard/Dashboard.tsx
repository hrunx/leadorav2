import React, { useState, useEffect } from 'react';
import { Search, Users, Building, Mail, TrendingUp, Calendar, ArrowRight, Plus, Eye, Play, BarChart3, Target, Globe, Zap } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useUserData } from '../../context/UserDataContext';
import { SearchService } from '../../services/searchService';

import { DEMO_USER_ID, DEMO_USER_EMAIL, isDemoUser } from '../../constants/demo';

interface DashboardProps {
  onStartNewSearch: () => void;
  onViewSearch: (searchId: string) => void;
  onCreateCampaign: () => void;
}

export default function Dashboard({ onStartNewSearch, onViewSearch, onCreateCampaign }: DashboardProps) {
  const { state: authState } = useAuth();
  const { state: userData } = useUserData();
  const [activeTab, setActiveTab] = useState('overview');
  const [realStats, setRealStats] = useState({
    totalLeads: 0,
    responseRate: 0,
    responseRateChange: 0
  });

  // Show all searches (most recent first). No slicing.
  const recentSearches = userData.searchHistory;
  const activeCampaigns = userData.activeCampaigns.slice(0, 3);
  
  // Simple demo user detection without CORS issues
  const isDemoUser = (userId?: string | null, userEmail?: string | null) => {
    return userId === DEMO_USER_ID || userId === 'demo-user' || userEmail === DEMO_USER_EMAIL;
  };
  
  const isDemo = isDemoUser(authState.user?.id, authState.user?.email);

  useEffect(() => {
    if (!isDemo) {
      calculateRealStats();
    }
  }, [userData, isDemo]);

  const calculateRealStats = async () => {
    // Leads = decision makers with linkedin or email or phone
    const totalLeads = await SearchService.countQualifiedLeads(authState.user?.id || '');

    // Response rate from campaigns stays as-is
    const totalSent = userData.activeCampaigns.reduce((sum, campaign) => {
      const stats = campaign.stats as any;
      return sum + (stats?.sent || 0);
    }, 0);
    const totalResponses = userData.activeCampaigns.reduce((sum, campaign) => {
      const stats = campaign.stats as any;
      return sum + (stats?.replied || 0);
    }, 0);
    const responseRate = totalSent > 0 ? Math.round((totalResponses / totalSent) * 100) : 0;

    setRealStats({ totalLeads, responseRate, responseRateChange: 0 });
  };

  const getDemoStats = () => [
    {
      label: 'Total Searches',
      value: 12,
      icon: Search,
      color: 'bg-blue-500',
      change: '+12%'
    },
    {
      label: 'Leads Generated',
      value: 1247,
      icon: Users,
      color: 'bg-green-500',
      change: '+23%'
    },
    {
      label: 'Campaigns Sent',
      value: 8,
      icon: Mail,
      color: 'bg-purple-500',
      change: '+8%'
    },
    {
      label: 'Response Rate',
      value: '24%',
      icon: TrendingUp,
      color: 'bg-orange-500',
      change: '+5%'
    }
  ];

  const getRealStats = () => [
    {
      label: 'Total Searches',
      value: userData.searchHistory.length,
      icon: Search,
      color: 'bg-blue-500',
      change: userData.searchHistory.length > 0 ? '+100%' : '0%'
    },
    {
      label: 'Leads Generated',
      value: realStats.totalLeads,
      icon: Users,
      color: 'bg-green-500',
      change: realStats.totalLeads > 0 ? '+100%' : '0%'
    },
    {
      label: 'Campaigns Sent',
      value: userData.totalCampaignsSent,
      icon: Mail,
      color: 'bg-purple-500',
      change: userData.totalCampaignsSent > 0 ? '+100%' : '0%'
    },
    {
      label: 'Response Rate',
      value: `${realStats.responseRate}%`,
      icon: TrendingUp,
      color: 'bg-orange-500',
      change: realStats.responseRate > 0 ? `+${realStats.responseRate}%` : '0%'
    }
  ];

  const stats = isDemo ? getDemoStats() : getRealStats();

  const quickActions = [
    {
      title: 'New Search',
      description: 'Start a new customer or supplier search',
      icon: Search,
      color: 'bg-blue-600',
      action: onStartNewSearch
    },
    {
      title: 'Create Campaign',
      description: 'Launch an email campaign to your leads',
      icon: Mail,
      color: 'bg-green-600',
      action: onCreateCampaign
    },
    {
      title: 'View Analytics',
      description: 'Analyze your campaign performance',
      icon: BarChart3,
      color: 'bg-purple-600',
      action: () => {}
    }
  ];

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getSearchTypeColor = (type: string) => {
    return type === 'customer' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800';
  };

  const getCampaignStatusColor = (status: string) => {
    switch (status) {
      case 'sent': return 'bg-green-100 text-green-800';
      case 'scheduled': return 'bg-blue-100 text-blue-800';
      case 'draft': return 'bg-gray-100 text-gray-800';
      default: return 'bg-purple-100 text-purple-800';
    }
  };

  return (
    <div className="space-y-8">
      {/* Welcome Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-8 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">
              Welcome back, {authState.user?.firstName}! 👋
            </h1>
            <p className="text-blue-100 text-lg">
              Ready to discover your next business opportunity?
            </p>
            <div className="flex items-center space-x-6 mt-4">
              <div className="flex items-center space-x-2">
                <Building className="w-5 h-5 text-blue-200" />
                <span className="text-blue-100">{authState.user?.company}</span>
              </div>
              <div className="flex items-center space-x-2">
                <Target className="w-5 h-5 text-blue-200" />
                <span className="text-blue-100">{authState.user?.industry}</span>
              </div>
            </div>
          </div>
          <div className="hidden md:block">
            <div className="w-32 h-32 bg-white bg-opacity-10 rounded-full flex items-center justify-center">
              <Globe className="w-16 h-16 text-white opacity-50" />
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <div key={index} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">{stat.label}</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{stat.value}</p>
                  <p className="text-sm text-green-600 mt-1">{stat.change} from last month</p>
                </div>
                <div className={`w-12 h-12 ${stat.color} rounded-lg flex items-center justify-center`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {quickActions.map((action, index) => {
            const Icon = action.icon;
            return (
              <button
                key={index}
                onClick={action.action}
                className="flex items-center space-x-4 p-4 border border-gray-200 rounded-xl hover:border-gray-300 hover:shadow-sm transition-all text-left"
              >
                <div className={`w-12 h-12 ${action.color} rounded-lg flex items-center justify-center`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{action.title}</h3>
                  <p className="text-sm text-gray-600">{action.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Searches */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Recent Searches</h2>
            <button
              onClick={onStartNewSearch}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>New Search</span>
            </button>
          </div>

          {recentSearches.length > 0 ? (
            <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
              {recentSearches.map((search) => (
                <div
                  key={search.id}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                >
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <span className={`px-2 py-1 text-xs rounded-full font-medium ${getSearchTypeColor(search.search_type || 'customer')}`}>
                        {search.search_type || 'customer'}
                      </span>
                      <span className="text-sm text-gray-500">{formatDate(search.timestamp)}</span>
                    </div>
                    <h3 className="font-medium text-gray-900 mb-1">
                      {search.product_service || 'Untitled Search'}
                    </h3>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                      <span className="flex items-center space-x-1">
                        <Users className="w-4 h-4" />
                        <span>
                          {(search.totals?.business_personas || 0) + (search.totals?.dm_personas || 0)} personas
                          {` (`}
                          {search.totals?.business_personas || 0} business, {search.totals?.dm_personas || 0} DM{`)`}
                        </span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <Building className="w-4 h-4" />
                        <span>{search.totals?.businesses || 0} businesses</span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <Target className="w-4 h-4" />
                        <span>{search.totals?.decision_makers || 0} decision makers</span>
                      </span>
                    </div>
                    <div className="flex items-center space-x-2 mt-2">
                      <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                        search.status === 'completed' ? 'bg-green-100 text-green-800' :
                        search.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                        search.status === 'failed' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {search.status || 'unknown'}
                      </span>
                      {search.industries && search.industries.length > 0 && (
                        <span className="text-xs text-gray-500">
                          {search.industries.slice(0, 2).join(', ')}
                          {search.industries.length > 2 && ` +${search.industries.length - 2} more`}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => onViewSearch(search.id)}
                    className="flex items-center space-x-2 px-3 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                    <span>View</span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No searches yet</h3>
              <p className="text-gray-600 mb-4">Start your first search to discover business opportunities</p>
              <button
                onClick={onStartNewSearch}
                className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors mx-auto"
              >
                <Search className="w-5 h-5" />
                <span>Start First Search</span>
              </button>
            </div>
          )}
        </div>

        {/* Active Campaigns */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Active Campaigns</h2>
            <button
              onClick={onCreateCampaign}
              className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>New Campaign</span>
            </button>
          </div>

          {activeCampaigns.length > 0 ? (
            <div className="space-y-4">
              {activeCampaigns.map((campaign) => (
                <div
                  key={campaign.id}
                  className="p-4 border border-gray-200 rounded-lg"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium text-gray-900">{campaign.name}</h3>
                    <span className={`px-2 py-1 text-xs rounded-full font-medium ${getCampaignStatusColor(campaign.status)}`}>
                      {campaign.status}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-4 gap-4 text-center">
                    <div>
                      <div className="text-lg font-semibold text-gray-900">{campaign.stats?.sent || 0}</div>
                      <div className="text-xs text-gray-600">Sent</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-blue-600">{campaign.stats?.opened || 0}</div>
                      <div className="text-xs text-gray-600">Opened</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-green-600">{campaign.stats?.clicked || 0}</div>
                      <div className="text-xs text-gray-600">Clicked</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-purple-600">{campaign.stats?.replied || 0}</div>
                      <div className="text-xs text-gray-600">Replied</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Mail className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No campaigns yet</h3>
              <p className="text-gray-600 mb-4">Create your first email campaign to reach your leads</p>
              <button
                onClick={onCreateCampaign}
                className="flex items-center space-x-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors mx-auto"
              >
                <Mail className="w-5 h-5" />
                <span>Create Campaign</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Subscription Status - Only show for demo user */}
      {isDemoUser(authState.user?.id, authState.user?.email) && (
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl border border-purple-200 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-purple-600 rounded-lg flex items-center justify-center">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Demo Mode</h3>
                <p className="text-gray-600">
                  Subscribe to unlock real lead generation and market intelligence
                </p>
              </div>
            </div>
            <button className="flex items-center space-x-2 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
              <span>Subscribe Now</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}