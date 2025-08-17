import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, Globe, Target, BarChart3, PieChart, ArrowRight, ArrowUp, ArrowDown, Filter, Download, Share, Search, Plus, ExternalLink, FileText } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { useUserData } from '../../context/UserDataContext';
import { useAuth } from '../../context/AuthContext';
// Cleaned stale commented imports
import { useRealTimeSearch } from '../../hooks/useRealTimeSearch';

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
  const palette = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
  const toPercent = (val: any): number => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const m = val.replace(/[^0-9.+-]/g, '');
      const n = Number(m);
      return isNaN(n) ? 0 : n;
    }
    return 0;
  };
  const hasSeries = (s?: unknown): s is number[] => Array.isArray(s) && s.every(n => typeof n === 'number');
  const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

  // Build a normalized 0-100 series from YoY growth like "+12%" when backend did not provide series
  const buildSeriesFromGrowth = (growthStr: any, points = 12): number[] => {
    const g = toPercent(growthStr) / 100; // e.g., 0.12
    const r = g !== 0 ? Math.pow(1 + g, 1 / points) - 1 : 0; // per-step rate
    const base = 60; // start index to render a visible area
    const arr: number[] = [];
    let v = base;
    for (let i = 0; i < points; i++) {
      v = v * (1 + r);
      arr.push(v);
    }
    // Normalize to 20..90 for nicer chart fill
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const span = max - min || 1;
    return arr.map(x => 20 + ((x - min) / span) * 70);
  };

  // Ensure we always have a series to plot for TAM
  const tamSeries: number[] | null = useMemo(() => {
    const series = (marketRow as any)?.tam_data?.series;
    if (hasSeries(series)) return series as number[];
    const growth = (marketRow as any)?.tam_data?.growth || (marketRow as any)?.sam_data?.growth || '0%';
    return buildSeriesFromGrowth(growth, 12);
  }, [marketRow]);

  // Donut chart arc builder
  const polarToCartesian = (cx: number, cy: number, r: number, angle: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const describeArc = (cx: number, cy: number, r: number, startAngle: number, endAngle: number) => {
    const start = polarToCartesian(cx, cy, r, endAngle);
    const end = polarToCartesian(cx, cy, r, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
  };

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
              {/* TAM/SAM/SOM */}
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-6">Market Size Analysis</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {Object.entries(blocksToRender).map(([key, data]) => (
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
                {/* Methodology/Explanation */}
                <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-gray-700">
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="font-semibold mb-2">How TAM was calculated</div>
                    <div>{(marketRow as any)?.tam_data?.calculation || 'Methodology pending – rerun research.'}</div>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="font-semibold mb-2">How SAM was calculated</div>
                    <div>{(marketRow as any)?.sam_data?.calculation || 'Methodology pending – rerun research.'}</div>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="font-semibold mb-2">How SOM was calculated</div>
                    <div>{(marketRow as any)?.som_data?.calculation || 'Methodology pending – rerun research.'}</div>
                  </div>
                </div>
              </div>

              {/* Market Growth Chart */}
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-6">Market Growth Projection</h3>
                <div className="bg-gray-50 rounded-xl p-4 sm:p-6">
                  <div className="w-full h-64 bg-white rounded-lg border border-gray-200 overflow-hidden">
                    {tamSeries && tamSeries.length ? (
                      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-full">
                        <defs>
                          <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.7" />
                            <stop offset="100%" stopColor="#bfdbfe" stopOpacity="0.2" />
                          </linearGradient>
                        </defs>
                        {(() => {
                          const series = tamSeries as number[];
                          const points = series.map((v: number, i: number) => `${(i/(series.length-1))*100},${40 - (clamp(v)/100)*40}`).join(' ');
                          const areaPoints = `0,40 ${points} 100,40`;
                          return (
                            <g>
                              <polyline fill="url(#grad)" stroke="none" points={areaPoints} />
                              <polyline fill="none" stroke="#2563eb" strokeWidth="2" points={points} />
                            </g>
                          );
                        })()}
                      </svg>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-500">No growth data yet</div>
                    )}
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
                      {competitorData.length > 0 ? (
                        <div className="flex flex-col items-center">
                          <svg viewBox="0 0 120 120" className="w-48 h-48">
                            {(() => {
                              const total = competitorData.reduce((s, c) => s + (Number(c.marketShare) || 0), 0) || 1;
                              let start = 0;
                              return competitorData.map((c: any, idx: number) => {
                                const val = Number(c.marketShare) || 0;
                                const angle = (val/total)*360;
                                const path = describeArc(60,60,50, start, start+angle);
                                const el = (
                                  <path key={idx} d={path} stroke={palette[idx%palette.length]} strokeWidth="20" fill="none" />
                                );
                                start += angle;
                                return el;
                              });
                            })()}
                          </svg>
                          <div className="mt-4 grid grid-cols-2 gap-2 w-full">
                            {competitorData.map((c:any, idx:number)=> (
                              <div key={c.name} className="flex items-center justify-between text-sm">
                                <div className="flex items-center space-x-2">
                                  <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: palette[idx%palette.length] }}></span>
                                  <span className="text-gray-700">{c.name}</span>
                                </div>
                                <span className="text-gray-900 font-medium">{c.marketShare}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="w-48 h-48 bg-white rounded-full border border-gray-200 mx-auto flex items-center justify-center mb-4">
                          <PieChart className="w-24 h-24 text-gray-300" />
                        </div>
                      )}
                    </div>
                  </div>

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
                          const growthPct = clamp(Number(String(c.growth || '0').replace(/[^0-9.-]/g, '')) || 0, -20, 50);

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
            <div className="space-y-6">
              <h3 className="text-xl font-semibold text-gray-900">Market Trends & Drivers</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {trends.length === 0 ? (
                  <div className="col-span-1 lg:col-span-2 bg-white border border-dashed border-gray-300 rounded-xl p-6 text-center text-gray-500">
                    No trend data yet. Retry market research to populate this section.
                  </div>
                ) : (
                  trends.map((trend, index) => (
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
                  ))
                )}
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
    </div>
  );
}