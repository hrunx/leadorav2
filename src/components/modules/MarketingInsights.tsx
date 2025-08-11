import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, Globe, Target, BarChart3, PieChart, ArrowRight, ArrowUp, ArrowDown, Filter, Download, Share, Search, Plus, ExternalLink, FileText } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { useUserData } from '../../context/UserDataContext';
import { useAuth } from '../../context/AuthContext';
// import { SearchService } from '../../services/searchService';
//
import { useRealTimeSearch } from '../../hooks/useRealTimeSearch';

import { isDemoUser } from '../../constants/demo';

export default function MarketingInsights() {
  const { state } = useAppContext();
  const { getCurrentSearch } = useUserData();
  const { state: authState } = useAuth();
  const currentSearch = getCurrentSearch();
  
  // Real-time data hook for progressive loading
  const realTimeData = useRealTimeSearch(currentSearch?.id || null);
  
  // UI state
  const [activeTab, setActiveTab] = useState('market-size');
  const [timeRange, setTimeRange] = useState('12m');
  
  // Legacy demo state
  const [demoMarketData, setDemoMarketData] = useState<any>(null);
  const [isLoadingDemo, setIsLoadingDemo] = useState(true);
  
  // Determine if we're in demo mode
  const isDemo = isDemoUser(authState.user?.id, authState.user?.email);
  
  // Use real-time data for real users, demo data for demo users
  const marketRow = isDemo ? demoMarketData : realTimeData.marketInsights.length > 0 ? realTimeData.marketInsights[0] : null;
  // Derive normalized blocks for rendering (tam/sam/som)
  const marketBlocks = isDemo
    ? (demoMarketData ? { tam: demoMarketData.tam, sam: demoMarketData.sam, som: demoMarketData.som } : null)
    : (marketRow ? { tam: (marketRow as any).tam_data, sam: (marketRow as any).sam_data, som: (marketRow as any).som_data } : null);

  const isLoading = isDemo ? isLoadingDemo : realTimeData.isLoading || !realTimeData.progress.market_insights_ready;
  const hasSearch = isDemo ? !!demoMarketData : !!currentSearch;
  const [competitorData, setCompetitorData] = useState<any[]>([]);
  const [trends, setTrends] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [researchSummary, setResearchSummary] = useState<string>('');
  const [methodology, setMethodology] = useState<string>('');

  useEffect(() => {
    if (isDemo) {
      setDemoMarketData(getStaticMarketData());
      setCompetitorData(getStaticCompetitorData());
      setTrends(getStaticTrends());
      setIsLoadingDemo(false);
    }
    // For real users, no need to set local state; rely on realTimeData
  }, [isDemo]);

  // remove unused loadData stub

  // Sync real-time market insights into local display state for real users
  useEffect(() => {
    if (isDemo) return;
    const row: any = marketRow;
    if (!row) {
      setCompetitorData([]);
      setTrends([]);
      setSources([]);
      setResearchSummary('');
      setMethodology('');
      return;
    }
    setCompetitorData(Array.isArray(row.competitor_data) ? row.competitor_data : []);
    setTrends(Array.isArray(row.trends) ? row.trends : []);
    setSources(Array.isArray(row.sources) ? row.sources : []);
    setResearchSummary(row.analysis_summary || row.opportunities?.summary || '');
    setMethodology(row.research_methodology || '');
  }, [isDemo, marketRow]);

  // Normalize sources to objects with at least title/url when backend returns string URLs
  const normalizedSources = useMemo(() => {
    return (sources || []).map((s: any) => {
      if (typeof s === 'string') return { title: s, url: s };
      // Some agents may return { title, url, date, used_for } or { source, url, focus_area }
      return s;
    });
  }, [sources]);

  const handleProceedToCampaigns = () => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'campaigns' }));
  };

  const getStaticMarketData = () => ({
    tam: { value: '$2.4B', growth: '+12%', description: 'Total Addressable Market' },
    sam: { value: '$850M', growth: '+18%', description: 'Serviceable Addressable Market' },
    som: { value: '$125M', growth: '+24%', description: 'Serviceable Obtainable Market' }
  });

  // ensure no unused ESLint disables remain

  const getStaticCompetitorData = () => [
    { name: 'Competitor A', marketShare: 35, revenue: '$420M', growth: '+8%' },
    { name: 'Competitor B', marketShare: 28, revenue: '$336M', growth: '+12%' },
    { name: 'Competitor C', marketShare: 15, revenue: '$180M', growth: '+5%' },
    { name: 'Others', marketShare: 22, revenue: '$264M', growth: '+15%' }
  ];

  const getStaticTrends = () => [
    { trend: 'AI-Powered Solutions', impact: 'High', growth: '+45%', description: 'Increasing demand for AI-driven business intelligence' },
    { trend: 'Remote Work Tools', impact: 'Medium', growth: '+32%', description: 'Growing need for distributed team collaboration' },
    { trend: 'Data Privacy Compliance', impact: 'High', growth: '+28%', description: 'Stricter regulations driving compliance solutions' },
    { trend: 'Mobile-First Platforms', impact: 'Medium', growth: '+22%', description: 'Shift towards mobile-optimized business tools' }
  ];

  const tabs = [
    { id: 'market-size', label: 'Market Size', icon: BarChart3 },
    { id: 'competition', label: 'Competition', icon: Target },
    { id: 'trends', label: 'Market Trends', icon: TrendingUp },
    { id: 'opportunities', label: 'Opportunities', icon: Globe },
    { id: 'sources', label: 'Research Sources', icon: FileText }
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h3 className="text-lg font-semibold text-gray-900">Generating market insights...</h3>
          <p className="text-gray-600">AI agents are analyzing market data and competitive intelligence</p>
        </div>
      </div>
    );
  }

  // Show empty state for real users without any searches
  if (!hasSearch && !isDemoUser(authState.user?.id, authState.user?.email)) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center max-w-md">
          <BarChart3 className="w-24 h-24 text-gray-300 mx-auto mb-6" />
          <h3 className="text-2xl font-semibold text-gray-900 mb-4">No Market Insights Yet</h3>
          <p className="text-gray-600 mb-8">
            Start a search to generate comprehensive market analysis and competitive intelligence for your industry.
          </p>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('navigate', { detail: 'search' }))}
            className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            <span>Start New Search</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Market Insights for "{state.searchData?.productService}"
          </h1>
          <p className="text-gray-600 mt-2">
            Comprehensive market analysis and competitive intelligence
          </p>
        </div>
        <button
          onClick={handleProceedToCampaigns}
          className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <span>Next: Campaign Management</span>
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-3 sm:space-x-4">
            <Filter className="w-5 h-5 text-gray-400" />
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="6m">Last 6 months</option>
              <option value="12m">Last 12 months</option>
              <option value="24m">Last 24 months</option>
            </select>
          </div>
          <div className="flex space-x-3">
            <button className="flex items-center space-x-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
              <Download className="w-4 h-4" />
              <span>Export</span>
            </button>
            <button className="flex items-center space-x-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
              <Share className="w-4 h-4" />
              <span>Share</span>
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-4 sm:px-6 overflow-x-auto no-scrollbar">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 py-4 border-b-2 font-medium transition-colors ${
                    isActive
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 sm:p-6">
          {activeTab === 'market-size' && (
            <div className="space-y-8">
              {/* TAM/SAM/SOM */}
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-6">Market Size Analysis</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {marketBlocks && Object.entries(marketBlocks).map(([key, data]) => (
                    <div key={key} className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-6 border border-blue-200">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-semibold text-gray-900">{data?.description || ''}</h4>
                        <div className={`flex items-center space-x-1 text-sm font-medium ${
                          data?.growth && typeof data.growth === 'string' && data.growth.startsWith('+') ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {data?.growth && typeof data.growth === 'string' && data.growth.startsWith('+') ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
                          <span>{data?.growth || 'N/A'}</span>
                        </div>
                      </div>
                      <div className="text-3xl font-bold text-gray-900 mb-2">{data?.value || 'N/A'}</div>
                      <div className="text-sm text-gray-600">
                        {key === 'tam' && 'Total market opportunity for your product category'}
                        {key === 'sam' && 'Portion of TAM you can realistically target'}
                        {key === 'som' && 'Realistic market share you can capture'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Market Growth Chart */}
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-6">Market Growth Projection</h3>
                <div className="bg-gray-50 rounded-xl p-8 text-center">
                  <div className="w-full h-64 bg-white rounded-lg border border-gray-200 flex items-center justify-center">
                    <div className="text-center">
                      <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                      <p className="text-gray-500">Interactive market growth chart would be displayed here</p>
                      <p className="text-sm text-gray-400 mt-2">Showing 5-year projection with key milestones</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'competition' && (
            <div className="space-y-8">
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-6">Competitive Landscape</h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Market Share */}
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-4">Market Share Distribution</h4>
                    <div className="bg-gray-50 rounded-xl p-6">
                      <div className="w-48 h-48 bg-white rounded-full border border-gray-200 mx-auto flex items-center justify-center mb-4">
                        <PieChart className="w-24 h-24 text-gray-300" />
                      </div>
                      <p className="text-center text-gray-500 text-sm">Market share visualization</p>
                    </div>
                  </div>

                  {/* Competitor Details */}
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-4">Key Competitors</h4>
                    <div className="space-y-4">
                      {competitorData.map((competitor, index) => (
                        <div key={index} className="bg-white border border-gray-200 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <h5 className="font-medium text-gray-900">{competitor.name}</h5>
                            <span className={`text-sm font-medium ${
                              competitor.growth?.startsWith('+') ? 'text-green-600' : 'text-red-600'
                            }`}>
                              {competitor.growth || 'N/A'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-sm text-gray-600">
                            <span>{competitor.marketShare}% market share</span>
                            <span>{competitor.revenue} revenue</span>
                          </div>
                          <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${competitor.marketShare}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'trends' && (
            <div className="space-y-6">
              <h3 className="text-xl font-semibold text-gray-900">Market Trends & Drivers</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {trends.map((trend, index) => (
                  <div key={index} className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-start justify-between mb-4">
                      <h4 className="font-semibold text-gray-900">{trend.trend}</h4>
                      <div className="flex items-center space-x-2">
                        <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                          trend.impact === 'High' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {trend.impact} Impact
                        </span>
                        <span className="text-green-600 font-medium text-sm">{trend.growth}</span>
                      </div>
                    </div>
                    <p className="text-gray-600 text-sm">{trend.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'opportunities' && (
            <div className="space-y-6">
              <h3 className="text-xl font-semibold text-gray-900">Market Opportunities</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div className="bg-green-50 border border-green-200 rounded-xl p-6">
                    <h4 className="font-semibold text-green-900 mb-4">High-Opportunity Segments</h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-green-800">Enterprise (1000+ employees)</span>
                        <span className="font-medium text-green-900">$450M opportunity</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-green-800">Mid-market (200-1000 employees)</span>
                        <span className="font-medium text-green-900">$280M opportunity</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-green-800">Technology sector</span>
                        <span className="font-medium text-green-900">$320M opportunity</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
                    <h4 className="font-semibold text-blue-900 mb-4">Geographic Expansion</h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-blue-800">European Union</span>
                        <span className="font-medium text-blue-900">$180M potential</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-blue-800">Asia-Pacific</span>
                        <span className="font-medium text-blue-900">$220M potential</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-blue-800">Latin America</span>
                        <span className="font-medium text-blue-900">$95M potential</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-purple-50 border border-purple-200 rounded-xl p-6">
                    <h4 className="font-semibold text-purple-900 mb-4">Emerging Opportunities</h4>
                    <div className="space-y-4">
                      <div>
                        <h5 className="font-medium text-purple-800 mb-1">AI Integration Services</h5>
                        <p className="text-sm text-purple-700">Growing demand for AI-powered business solutions</p>
                        <span className="text-xs text-purple-600">+65% growth potential</span>
                      </div>
                      <div>
                        <h5 className="font-medium text-purple-800 mb-1">Compliance Automation</h5>
                        <p className="text-sm text-purple-700">Increasing regulatory requirements driving automation</p>
                        <span className="text-xs text-purple-600">+42% growth potential</span>
                      </div>
                      <div>
                        <h5 className="font-medium text-purple-800 mb-1">Mobile-First Solutions</h5>
                        <p className="text-sm text-purple-700">Shift towards mobile-optimized business tools</p>
                        <span className="text-xs text-purple-600">+38% growth potential</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-orange-50 border border-orange-200 rounded-xl p-6">
                    <h4 className="font-semibold text-orange-900 mb-4">Recommended Actions</h4>
                    <div className="space-y-3">
                      <div className="flex items-start space-x-3">
                        <div className="w-2 h-2 bg-orange-500 rounded-full mt-2"></div>
                        <span className="text-sm text-orange-800">Focus on enterprise segment for highest ROI</span>
                      </div>
                      <div className="flex items-start space-x-3">
                        <div className="w-2 h-2 bg-orange-500 rounded-full mt-2"></div>
                        <span className="text-sm text-orange-800">Develop AI-powered features to stay competitive</span>
                      </div>
                      <div className="flex items-start space-x-3">
                        <div className="w-2 h-2 bg-orange-500 rounded-full mt-2"></div>
                        <span className="text-sm text-orange-800">Consider European expansion within 12 months</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'sources' && (
            <div className="space-y-8">
              {/* Research Summary */}
              {researchSummary && (
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-6">Research Summary</h3>
                  <div className="bg-blue-50 rounded-xl p-6 border border-blue-200">
                    <p className="text-gray-800 leading-relaxed">{researchSummary}</p>
                  </div>
                </div>
              )}

              {/* Research Methodology */}
              {methodology && (
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-6">Research Methodology</h3>
                  <div className="bg-green-50 rounded-xl p-6 border border-green-200">
                    <div className="flex items-start space-x-3">
                      <Search className="w-5 h-5 text-green-600 mt-1" />
                      <p className="text-gray-800 leading-relaxed">{methodology}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Research Sources */}
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-6">Data Sources & References</h3>
                {normalizedSources.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4">
                    {normalizedSources.map((source: any) => (
                      <div key={source.url || source.title} className="bg-white rounded-xl p-6 border border-gray-200 hover:border-blue-300 transition-colors">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-2">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                {source.focus_area || (Array.isArray(source.used_for) ? source.used_for.join(', ') : 'Research')}
                              </span>
                              {source.source && (
                                <span className="text-sm text-gray-500">{source.source}</span>
                              )}
                            </div>
                            <h4 className="font-semibold text-gray-900 mb-2">{source.title || source.url}</h4>
                            {source.snippet && (
                              <p className="text-gray-600 text-sm leading-relaxed mb-3">{source.snippet}</p>
                            )}
                            {source.url && (
                              <a 
                                href={source.url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="inline-flex items-center space-x-1 text-blue-600 hover:text-blue-800 text-sm font-medium"
                              >
                                <span>View Source</span>
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 bg-gray-50 rounded-xl border border-gray-200">
                    <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                    <h4 className="text-lg font-semibold text-gray-600 mb-2">Research Sources Unavailable</h4>
                    <p className="text-gray-500">
                      {hasSearch ? 
                        'Sources will be available once the market research analysis is complete.' :
                        'Start a search to see research sources and methodology.'
                      }
                    </p>
                  </div>
                )}
              </div>

              {/* Research Quality Indicators */}
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-6">Research Quality</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-6 border border-green-200">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-gray-900">Sources Used</h4>
                      <span className="text-2xl font-bold text-green-600">{sources.length}</span>
                    </div>
                    <p className="text-sm text-gray-600">Independent data sources analyzed</p>
                  </div>
                  
                  <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-xl p-6 border border-blue-200">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-gray-900">AI Enhanced</h4>
                      <span className="text-2xl font-bold text-blue-600">100%</span>
                    </div>
                    <p className="text-sm text-gray-600">AI-powered analysis and insights</p>
                  </div>
                  
                  <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl p-6 border border-purple-200">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-gray-900">Real-time</h4>
                      <span className="text-2xl font-bold text-purple-600">Live</span>
                    </div>
                    <p className="text-sm text-gray-600">Current market data and trends</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}