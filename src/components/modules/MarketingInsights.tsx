import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, Globe, Target, BarChart3, PieChart, ArrowRight, ArrowUp, ArrowDown, Filter, Download, Share, Search, Plus, ExternalLink, FileText, BookOpen, Lightbulb, TrendingDown } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { useUserData } from '../../context/UserDataContext';
import { useAuth } from '../../context/AuthContext';
// Cleaned stale commented imports
import { useRealTimeSearch } from '../../hooks/useRealTimeSearch';
import { InteractiveLineChart, InteractiveBarChart, InteractivePieChart, DrilldownPanel } from './InteractiveCharts';

import { isDemoUser } from '../../constants/demo';

export default function MarketingInsights() {
  const { state } = useAppContext();
  const { getCurrentSearch } = useUserData();
  const { state: authState } = useAuth();
  const currentSearch = getCurrentSearch();
  // Wire retryMarketResearch event to call Netlify function once per mount
  useEffect(() => {
    const handler = async () => {
      try {
        if (!currentSearch?.id) return;
        await fetch('/.netlify/functions/retry-market-research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ search_id: currentSearch.id })
        });
      } catch {}
    };
    const listener = () => { void handler(); };
    window.addEventListener('retryMarketResearch', listener as EventListener);
    return () => window.removeEventListener('retryMarketResearch', listener as EventListener);
  }, [currentSearch?.id]);
  
  // Real-time data hook for progressive loading
  const realTimeData = useRealTimeSearch(currentSearch?.id || null);
  
  // UI state
  const [activeTab, setActiveTab] = useState('market-size');
  const [timeRange, setTimeRange] = useState('12m');
  const [, setSelectedMetric] = useState<string | null>(null);
  const [drilldownPanels, setDrilldownPanels] = useState<Record<string, boolean>>({
    'tam-breakdown': false,
    'competitor-analysis': false,
    'trend-details': false,
    'opportunity-drill': false,
    'methodology': false
  });
  const [citationModal, setCitationModal] = useState<{ show: boolean; source: any }>({ show: false, source: null });
  
  // Legacy demo state
  const [demoMarketData, setDemoMarketData] = useState<any>(null);
  const [isLoadingDemo, setIsLoadingDemo] = useState(true);
  
  // Determine if we're in demo mode
  const isDemo = isDemoUser(authState.user?.id, authState.user?.email);
  
  // Parse helper for JSONB fields that may arrive as strings
  const parseMaybeJSON = (v: any) => {
    if (v && typeof v === 'string') {
      const t = v.trim();
      if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
        try { return JSON.parse(t); } catch {}
      }
    }
    return v;
  };
  // Use real-time data for real users, demo data for demo users
  const marketRowRaw = useMemo(() => {
    return isDemo
      ? demoMarketData
      : (realTimeData.marketInsights.length > 0 ? realTimeData.marketInsights[0] : null);
  }, [isDemo, demoMarketData, realTimeData.marketInsights]);

  const marketRow: any = useMemo(() => {
    if (!marketRowRaw) return null;
    return {
      ...marketRowRaw,
      tam_data: parseMaybeJSON((marketRowRaw as any).tam_data),
      sam_data: parseMaybeJSON((marketRowRaw as any).sam_data),
      som_data: parseMaybeJSON((marketRowRaw as any).som_data),
      competitor_data: parseMaybeJSON((marketRowRaw as any).competitor_data),
      trends: parseMaybeJSON((marketRowRaw as any).trends),
      opportunities: parseMaybeJSON((marketRowRaw as any).opportunities),
      sources: parseMaybeJSON((marketRowRaw as any).sources)
    };
  }, [marketRowRaw]);
  // Derive normalized blocks for rendering (tam/sam/som)
  const marketBlocks = isDemo
    ? (demoMarketData ? { tam: demoMarketData.tam, sam: demoMarketData.sam, som: demoMarketData.som } : null)
    : (marketRow ? { tam: marketRow.tam_data, sam: marketRow.sam_data, som: marketRow.som_data } : null);
  // Always render placeholders so the UI is not empty when insights are missing
  const fallbackBlocks = useMemo(() => ({
    tam: { value: 'N/A', growth: '', description: 'Total Addressable Market' },
    sam: { value: 'N/A', growth: '', description: 'Serviceable Addressable Market' },
    som: { value: 'N/A', growth: '', description: 'Serviceable Obtainable Market' }
  }), []);
  const blocksToRender = marketBlocks || fallbackBlocks;

  // Stop loading once the run is completed, even if no row exists (show retry UI instead)
  const isLoading = isDemo
    ? isLoadingDemo
    : (
      realTimeData.isLoading ||
      (!marketRow && realTimeData.progress.phase !== 'completed' && !realTimeData.progress.market_insights_ready)
    );
  // If completed with no row, show the retry panel
  const hasError = !isDemo && !marketRow && realTimeData.progress.phase === 'completed';
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
      let used_for: string[] | undefined = undefined;
      if (Array.isArray(s.used_for)) used_for = s.used_for;
      else if (typeof s.focus_area === 'string' && s.focus_area) used_for = [s.focus_area];
      return {
        title: s.title || s.url || s.source || 'Source',
        url: s.url || '',
        snippet: s.snippet || '',
        date: s.date || null,
        used_for: used_for,
        source: s.source || undefined
      };
    });
  }, [sources]);

  // ---- Lightweight chart helpers (inline SVG) ----
  const palette = useMemo(() => ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'], []);
  // Utility function for clamping values
  const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

  // Removed unused chart helpers - now using InteractiveCharts components

  const handleProceedToCampaigns = () => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'campaigns' }));
  };

  const toggleDrilldown = (panelId: string) => {
    setDrilldownPanels(prev => ({
      ...prev,
      [panelId]: !prev[panelId]
    }));
  };

  const handleChartInteraction = (type: string, _data: any, index?: number) => {
    setSelectedMetric(`${type}-${index}`);
    // Could trigger additional data fetching or detailed views
    // Chart interaction handled - data available for future drill-down features
  };

  const openCitationModal = (source: any) => {
    setCitationModal({ show: true, source });
  };

  const closeCitationModal = () => {
    setCitationModal({ show: false, source: null });
  };

  // Process data for interactive charts
  const processedChartData = useMemo(() => {
    if (!marketRow) return null;

    // TAM/SAM/SOM trend data
    const marketSizeData = [
      { label: 'TAM', value: parseFloat(blocksToRender.tam.value.replace(/[$B,M,K]/g, '')) || 2400, color: '#3b82f6' },
      { label: 'SAM', value: parseFloat(blocksToRender.sam.value.replace(/[$B,M,K]/g, '')) || 850, color: '#10b981' },
      { label: 'SOM', value: parseFloat(blocksToRender.som.value.replace(/[$B,M,K]/g, '')) || 125, color: '#f59e0b' }
    ];

    // Competitor market share data
    const competitorChartData = competitorData.map((comp, index) => ({
      label: comp.name,
      value: comp.marketShare,
      metadata: { revenue: comp.revenue, growth: comp.growth },
      color: palette[index % palette.length]
    }));

    // Growth trend over time (synthetic data based on growth rates)
    const growthTrendData = [];
    const baseValue = 100;
    const growthRate = parseFloat(blocksToRender.tam.growth?.replace(/[^0-9.-]/g, '') || '0') / 100;
    
    for (let i = 0; i < 12; i++) {
      const monthValue = baseValue * Math.pow(1 + growthRate / 12, i);
      growthTrendData.push({
        label: new Date(Date.now() - (11 - i) * 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'short' }),
        value: monthValue,
        metadata: { month: i, growth: growthRate }
      });
    }

    // Trends impact data
    const trendsImpactData = trends.map((trend) => ({
      label: trend.trend,
      value: trend.impact === 'High' ? 90 : trend.impact === 'Medium' ? 60 : 30,
      metadata: { growth: trend.growth, description: trend.description },
      color: trend.impact === 'High' ? '#ef4444' : trend.impact === 'Medium' ? '#f59e0b' : '#10b981'
    }));

    return {
      marketSize: marketSizeData,
      competitors: competitorChartData,
      growthTrend: growthTrendData,
      trendsImpact: trendsImpactData
    };
  }, [marketRow, blocksToRender, competitorData, trends, palette]);

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

  // Do not early-return on error; render the page with placeholders and a retry banner

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

      {hasError && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <p className="text-yellow-800 text-sm font-medium">No validated market insights yet. Retry to populate charts and tables.</p>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('retryMarketResearch'))}
              className="px-3 py-1.5 text-sm bg-yellow-600 text-white rounded hover:bg-yellow-700"
            >
              Retry Market Research
            </button>
          </div>
        </div>
      )}

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
              {/* Interactive Market Size Overview */}
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-semibold text-gray-900">Market Size Analysis</h3>
                  <button
                    onClick={() => openCitationModal({ type: 'methodology', data: marketRow })}
                    className="flex items-center space-x-2 text-sm text-blue-600 hover:text-blue-800"
                  >
                    <BookOpen className="w-4 h-4" />
                    <span>View Methodology</span>
                  </button>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Market Size Chart */}
                  {processedChartData && (
                    <InteractiveBarChart
                      title="Market Size Breakdown"
                      data={processedChartData.marketSize}
                      onBarClick={(point, index) => handleChartInteraction('market-size', point, index)}
                    />
                  )}
                  
                  {/* Growth Trend Chart */}
                  {processedChartData && (
                    <InteractiveLineChart
                      title="Market Growth Projection"
                      data={processedChartData.growthTrend}
                      onPointClick={(point, index) => handleChartInteraction('growth-trend', point, index)}
                    />
                  )}
                </div>
                
                {/* TAM/SAM/SOM Cards with Enhanced Info */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
                  {Object.entries(blocksToRender).map(([key, data]) => (
                    <div key={key} className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-6 border border-blue-200 cursor-pointer hover:shadow-lg transition-shadow">
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
                      <div className="text-sm text-gray-600 mb-4">
                        {key === 'tam' && 'Total market opportunity for your product category'}
                        {key === 'sam' && 'Portion of TAM you can realistically target'}
                        {key === 'som' && 'Realistic market share you can capture'}
                      </div>
                      <button
                        onClick={() => toggleDrilldown(`${key}-breakdown`)}
                        className="text-xs text-blue-600 hover:text-blue-800 flex items-center space-x-1"
                      >
                        <Lightbulb className="w-3 h-3" />
                        <span>View Details</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Drilldown Panels */}
              <div className="space-y-4">
                <DrilldownPanel
                  title="TAM Calculation Breakdown"
                  isOpen={drilldownPanels['tam-breakdown']}
                  onToggle={() => toggleDrilldown('tam-breakdown')}
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="font-medium text-gray-900 mb-3">Calculation Method</h4>
                      <p className="text-sm text-gray-600 mb-4">
                        {(marketRow as any)?.tam_data?.calculation || 'Top-down analysis using industry reports and market sizing studies.'}
                      </p>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Global Market Size:</span>
                          <span className="font-medium">${processedChartData?.marketSize[0]?.value || 2400}M</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Growth Rate (YoY):</span>
                          <span className="font-medium text-green-600">{blocksToRender.tam.growth}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Market Maturity:</span>
                          <span className="font-medium">Growth Stage</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900 mb-3">Key Assumptions</h4>
                      <ul className="text-sm text-gray-600 space-y-1">
                        <li>• Market penetration rate: 15-25%</li>
                        <li>• Technology adoption curve: Early majority</li>
                        <li>• Regulatory environment: Favorable</li>
                        <li>• Economic factors: Stable growth</li>
                      </ul>
                      {normalizedSources.length > 0 && (
                        <button
                          onClick={() => openCitationModal(normalizedSources[0])}
                          className="mt-3 text-xs text-blue-600 hover:text-blue-800 flex items-center space-x-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>View Sources</span>
                        </button>
                      )}
                    </div>
                  </div>
                </DrilldownPanel>
                
                <DrilldownPanel
                  title="Market Size Methodology"
                  isOpen={drilldownPanels['methodology']}
                  onToggle={() => toggleDrilldown('methodology')}
                >
                  <div className="prose prose-sm max-w-none">
                    <p className="text-gray-600">
                      {methodology || 'Our market sizing approach combines top-down industry analysis with bottom-up validation using proprietary data sources and AI-powered market intelligence.'}
                    </p>
                    {researchSummary && (
                      <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                        <h4 className="font-medium text-blue-900 mb-2">Research Summary</h4>
                        <p className="text-blue-800">{researchSummary}</p>
                      </div>
                    )}
                  </div>
                </DrilldownPanel>
              </div>
            </div>
          )}

          {activeTab === 'competition' && (
            <div className="space-y-8">
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-6">Competitive Landscape</h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Interactive Market Share Chart */}
                  {processedChartData && processedChartData.competitors.length > 0 ? (
                    <InteractivePieChart
                      title="Market Share Distribution"
                      data={processedChartData.competitors}
                      onSliceClick={(point, index) => handleChartInteraction('competitor', point, index)}
                    />
                  ) : (
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Market Share Distribution</h3>
                      <div className="w-48 h-48 bg-gray-50 rounded-full border border-gray-200 mx-auto flex items-center justify-center">
                        <PieChart className="w-24 h-24 text-gray-300" />
                      </div>
                      <p className="text-center text-gray-500 mt-4">No competitor data available yet</p>
                    </div>
                  )}

                  {/* Competitor Details */}
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-4">Key Competitors</h4>
                    <div className="space-y-4">
                      {competitorData.length === 0 && (
                        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-6 text-center text-gray-500">
                          No competitor data yet. Retry market research to populate this section.
                        </div>
                      )}
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
                {/* Positioning Map (Share vs Growth) */}
                <div className="mt-8">
                  <h4 className="font-semibold text-gray-900 mb-4">Competitive Positioning (Share vs Growth)</h4>
                  <div className="bg-gray-50 rounded-xl p-6">
                    <div className="relative w-full h-72 bg-white border border-gray-200 rounded">
                      <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                        <line x1="10" y1="50" x2="95" y2="50" stroke="#e5e7eb" strokeWidth="0.8" />
                        <line x1="10" y1="50" x2="10" y2="5" stroke="#e5e7eb" strokeWidth="0.8" />
                        <text x="12" y="10" fontSize="3" fill="#6b7280">High Growth</text>
                        <text x="12" y="58" fontSize="3" fill="#6b7280">Low Growth</text>
                        <text x="78" y="58" fontSize="3" fill="#6b7280">High Share</text>
                      </svg>
                      <div className="absolute inset-0">
                        {(competitorData || []).map((c: any, idx: number) => {
                          const share = clamp(Number(String(c.marketShare).replace(/[^0-9.]/g, '')) || 0);
                          const growthPct = clamp(
                            Number(String(c.growth || '0').replace(/[^0-9.-]/g, '')) || 0,
                            -20,
                            50
                          );
                          const x = 10 + (share/100) * 85;
                          const y = 50 - ((growthPct + 20) / 70) * 45;
                          const color = palette[idx % palette.length];
                          return (
                            <div key={c.name} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}>
                              <div className="flex items-center space-x-1">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                                <span className="text-xs text-gray-700 whitespace-nowrap">{c.name}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'trends' && (
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold text-gray-900">Market Trends & Drivers</h3>
                <button
                  onClick={() => toggleDrilldown('trend-details')}
                  className="flex items-center space-x-2 text-sm text-blue-600 hover:text-blue-800"
                >
                  <TrendingUp className="w-4 h-4" />
                  <span>Trend Analysis</span>
                </button>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Trends Impact Chart */}
                {processedChartData && processedChartData.trendsImpact.length > 0 ? (
                  <InteractiveBarChart
                    title="Trend Impact Assessment"
                    data={processedChartData.trendsImpact}
                    onBarClick={(point, index) => handleChartInteraction('trend', point, index)}
                  />
                ) : (
                  <div className="bg-white border border-dashed border-gray-300 rounded-xl p-6 text-center text-gray-500">
                    No trend data yet. Retry market research to populate this section.
                  </div>
                )}
                
                {/* Trend Details */}
                <div className="space-y-4">
                  {trends.length > 0 ? (
                    trends.map((trend, index) => (
                      <div 
                        key={index} 
                        className="bg-white border border-gray-200 rounded-xl p-6 cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => handleChartInteraction('trend-detail', trend, index)}
                      >
                        <div className="flex items-start justify-between mb-4">
                          <h4 className="font-semibold text-gray-900">{trend.trend}</h4>
                          <div className="flex items-center space-x-2">
                            <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                              trend.impact === 'High' ? 'bg-red-100 text-red-800' : 
                              trend.impact === 'Medium' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'
                            }`}>
                              {trend.impact} Impact
                            </span>
                            <span className="text-green-600 font-medium text-sm">{trend.growth}</span>
                          </div>
                        </div>
                        <p className="text-gray-600 text-sm">{trend.description}</p>
                      </div>
                    ))
                  ) : (
                    <div className="bg-white border border-dashed border-gray-300 rounded-xl p-6 text-center text-gray-500">
                      No trend details available yet.
                    </div>
                  )}
                </div>
              </div>
              
              {/* Trend Analysis Drilldown */}
              <DrilldownPanel
                title="Detailed Trend Analysis"
                isOpen={drilldownPanels['trend-details']}
                onToggle={() => toggleDrilldown('trend-details')}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-medium text-gray-900 mb-3">Market Drivers</h4>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li className="flex items-center space-x-2">
                        <TrendingUp className="w-4 h-4 text-green-500" />
                        <span>Digital transformation acceleration</span>
                      </li>
                      <li className="flex items-center space-x-2">
                        <TrendingUp className="w-4 h-4 text-green-500" />
                        <span>Regulatory compliance requirements</span>
                      </li>
                      <li className="flex items-center space-x-2">
                        <TrendingUp className="w-4 h-4 text-green-500" />
                        <span>Cost optimization pressures</span>
                      </li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900 mb-3">Market Challenges</h4>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li className="flex items-center space-x-2">
                        <TrendingDown className="w-4 h-4 text-red-500" />
                        <span>Economic uncertainty</span>
                      </li>
                      <li className="flex items-center space-x-2">
                        <TrendingDown className="w-4 h-4 text-red-500" />
                        <span>Skills shortage in key areas</span>
                      </li>
                      <li className="flex items-center space-x-2">
                        <TrendingDown className="w-4 h-4 text-red-500" />
                        <span>Legacy system constraints</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </DrilldownPanel>
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

                  <div className="bg-purple-50 border border-purple-200 rounded-xl p-6">
                    <h4 className="font-semibold text-purple-900 mb-4">Emerging Opportunities</h4>
                    {trends.length === 0 ? (
                      <div className="text-sm text-purple-800">No opportunities extracted yet. Retry market research.</div>
                    ) : (
                      <div className="space-y-4">
                        {trends.slice(0, 3).map((t, i) => (
                          <div key={i}>
                            <h5 className="font-medium text-purple-800 mb-1">{t.trend}</h5>
                            <p className="text-sm text-purple-700">{t.description || 'Emerging area based on trends'}</p>
                            <span className="text-xs text-purple-600">{t.growth || ''}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-orange-50 border border-orange-200 rounded-xl p-6">
                    <h4 className="font-semibold text-orange-900 mb-4">Recommended Actions</h4>
                    {competitorData.length === 0 && trends.length === 0 ? (
                      <div className="text-sm text-orange-800">Actions will appear once analysis is available.</div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-start space-x-3">
                          <div className="w-2 h-2 bg-orange-500 rounded-full mt-2"></div>
                          <span className="text-sm text-orange-800">Focus on segments with highest opportunity</span>
                        </div>
                        <div className="flex items-start space-x-3">
                          <div className="w-2 h-2 bg-orange-500 rounded-full mt-2"></div>
                          <span className="text-sm text-orange-800">Prioritize features aligned with trends</span>
                        </div>
                      </div>
                    )}
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

      {/* Citation Modal */}
      {citationModal.show && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Research Citation</h3>
                <button
                  onClick={closeCitationModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <ExternalLink className="w-5 h-5" />
                </button>
              </div>
              
              {citationModal.source && (
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Source Information</h4>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="font-medium text-gray-700">Title: </span>
                          <span className="text-gray-600">{citationModal.source.title || 'Research methodology'}</span>
                        </div>
                        {citationModal.source.url && (
                          <div>
                            <span className="font-medium text-gray-700">URL: </span>
                            <a 
                              href={citationModal.source.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 break-all"
                            >
                              {citationModal.source.url}
                            </a>
                          </div>
                        )}
                        {citationModal.source.snippet && (
                          <div>
                            <span className="font-medium text-gray-700">Description: </span>
                            <span className="text-gray-600">{citationModal.source.snippet}</span>
                          </div>
                        )}
                        {citationModal.source.used_for && (
                          <div>
                            <span className="font-medium text-gray-700">Used for: </span>
                            <span className="text-gray-600">{Array.isArray(citationModal.source.used_for) ? citationModal.source.used_for.join(', ') : citationModal.source.used_for}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Research Quality</h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center p-3 bg-blue-50 rounded-lg">
                        <div className="text-lg font-bold text-blue-600">A+</div>
                        <div className="text-xs text-gray-600">Source Quality</div>
                      </div>
                      <div className="text-center p-3 bg-green-50 rounded-lg">
                        <div className="text-lg font-bold text-green-600">95%</div>
                        <div className="text-xs text-gray-600">Confidence</div>
                      </div>
                      <div className="text-center p-3 bg-purple-50 rounded-lg">
                        <div className="text-lg font-bold text-purple-600">Real-time</div>
                        <div className="text-xs text-gray-600">Data Age</div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="pt-4 border-t border-gray-200">
                    <p className="text-xs text-gray-500">
                      This information was gathered and analyzed by our AI research agents using proprietary methodologies and multiple data sources to ensure accuracy and relevance.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}