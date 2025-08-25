import { useState, useEffect, useCallback } from 'react';
import logger from '../lib/logger';
import { Search, Users, Building, UserCheck, TrendingUp, CheckCircle, Loader, AlertCircle } from 'lucide-react';

interface AgentProgressOverlayProps {
  searchId: string;
  isVisible: boolean;
  onComplete: () => void;
  onEarlyNavigation?: () => void;
}

interface ProgressData {
  phase: string;
  progress_pct: number;
  status: string;
  error?: unknown;
  updated_at: string;
}

interface DataCounts {
  business_personas: number;
  businesses: number;
  dm_personas: number;
  decision_makers: number;
  market_insights: number;
}

const AgentProgressOverlay: React.FC<AgentProgressOverlayProps> = ({
  searchId,
  isVisible,
  onComplete,
  onEarlyNavigation
}) => {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [dataCounts, setDataCounts] = useState<DataCounts>({
    business_personas: 0,
    businesses: 0,
    dm_personas: 0,
    decision_makers: 0,
    market_insights: 0
  });
  const [currentPhase, setCurrentPhase] = useState('starting');
  const [firstDataSeen, setFirstDataSeen] = useState(false);
  const [hasNavigatedEarly, setHasNavigatedEarly] = useState(false);

  const phases = [
    { key: 'starting', label: 'Initializing', icon: Search, color: 'text-blue-500' },
    { key: 'business_personas', label: 'Creating Personas', icon: Users, color: 'text-purple-500' },
    { key: 'dm_personas', label: 'Creating DM Personas', icon: Users, color: 'text-pink-500' },
    { key: 'business_discovery', label: 'Finding Businesses', icon: Building, color: 'text-green-500' },
    { key: 'decision_makers', label: 'Mapping Decision Makers', icon: UserCheck, color: 'text-orange-500' },
    { key: 'market_research', label: 'Generating Insights', icon: TrendingUp, color: 'text-indigo-500' },
    { key: 'completed', label: 'Complete', icon: CheckCircle, color: 'text-emerald-500' }
  ];

  const pollProgress = useCallback(async () => {
    try {
      const response = await fetch('/.netlify/functions/check-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search_id: searchId })
      });
      
      if (response.ok) {
        const data = await response.json();
        setProgress(data.progress);
        setDataCounts(data.data_counts);
        // Flag once when we see initial data so UI can show "Live results" hint
        if (!firstDataSeen && (
          data.data_counts.business_personas > 0 ||
          data.data_counts.dm_personas > 0 ||
          data.data_counts.businesses > 0 ||
          data.data_counts.decision_makers > 0 ||
          data.data_counts.market_insights > 0
        )) {
          setFirstDataSeen(true);
        }
        // Normalize any legacy/alias phases coming from backend to UI phases
        const rawPhase = data.progress.phase || 'starting';
        const normalizedPhase = ((): string => {
          switch (rawPhase) {
            case 'personas': return 'business_personas';
            case 'businesses': return 'business_discovery';
            case 'market_insights': return 'market_research';
            case 'parallel_processing': return 'business_discovery';
            case 'business_personas_completed': return 'business_personas';
            case 'dm_personas_completed': return 'dm_personas';
            default: return rawPhase;
          }
        })();
        // Derive a safe UI phase from data counts and progress percentage
        const pct = Number(data?.progress?.progress_pct || 0);
        const derivedPhase = (() => {
          if (data.data_counts.market_insights > 0) return 'market_research';
          if (data.data_counts.decision_makers > 0) return 'decision_makers';
          if (data.data_counts.businesses > 0) return 'business_discovery';
          if (data.data_counts.dm_personas >= 3) return 'dm_personas';
          if (data.data_counts.business_personas >= 3) return 'business_personas';
          if (normalizedPhase === 'completed' || pct >= 100) return 'completed';
          if (pct >= 85) return 'market_research';
          if (pct >= 40) return 'business_discovery';
          if (pct >= 10) return 'business_personas';
          return normalizedPhase;
        })();
        setCurrentPhase(derivedPhase);
        // Early navigation when business personas are ready (even 1 is enough to show the page)
        if (!hasNavigatedEarly &&
            data.data_counts.business_personas >= 1 &&
            onEarlyNavigation) {
          setHasNavigatedEarly(true);
          setTimeout(() => {
            onEarlyNavigation();
          }, 1000);
        }
        
        // Only complete automatically when finished AND business personas exist,
        // so users are not navigated into an empty screen
        if (data.progress.phase === 'completed') {
          if (data.data_counts.business_personas >= 1) {
            setTimeout(() => { onComplete(); }, 2000);
          }
        } else if (data.progress.phase === 'failed') {
          setTimeout(() => { onComplete(); }, 2000);
        }
      }
    } catch (error: any) {
      logger.warn('Error polling progress', { error: error?.message || String(error) });
    }
  }, [onEarlyNavigation, onComplete, firstDataSeen, hasNavigatedEarly, searchId]);

  useEffect(() => {
    if (isVisible && searchId) {
      pollProgress();
      const interval = setInterval(pollProgress, 3000);
      return () => clearInterval(interval);
    }
  }, [isVisible, searchId, pollProgress]);

  if (!isVisible) return null;

  const getCurrentPhaseIndex = () => {
    const idx = phases.findIndex(p => p.key === currentPhase);
    return idx === -1 ? 0 : idx;
  };

  const currentPhaseIndex = getCurrentPhaseIndex();
  const progressPct: number = typeof progress?.progress_pct === 'number' ? progress.progress_pct : 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-6 sm:p-8 w-full max-w-xl sm:max-w-2xl max-h-[90vh] overflow-hidden animate-in fade-in duration-300">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-6 h-6 sm:w-8 sm:h-8 text-white animate-pulse" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">AI Agents Working</h2>
          <p className="text-sm sm:text-base text-gray-600">Our AI agents are analyzing your market and finding leads</p>
          {firstDataSeen && (
            <p className="text-blue-600 text-xs sm:text-sm mt-1">Live results are loading in the background…</p>
          )}
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-700">Overall Progress</span>
            <span className="text-sm font-medium text-gray-900">{`${progressPct}%`}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div 
              className="bg-gradient-to-r from-blue-500 to-purple-600 h-3 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Phases */}
        <div className="space-y-3 sm:space-y-4 mb-6 sm:mb-8 overflow-y-auto pr-1" style={{ maxHeight: '42vh' }}>
          {phases.map((phase, index) => {
            const Icon = phase.icon;
            const isCompleted = index < currentPhaseIndex;
            const isCurrent = index === currentPhaseIndex;
            // const isPending = index > currentPhaseIndex;

            return (
              <div key={phase.key} className={`flex items-center p-3 sm:p-4 rounded-lg border-2 transition-all duration-300 ${
                isCompleted ? 'bg-green-50 border-green-200' :
                isCurrent ? 'bg-blue-50 border-blue-200 shadow-md' :
                'bg-gray-50 border-gray-200'
              }`}>
                <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center mr-3 sm:mr-4 ${
                  isCompleted ? 'bg-green-500 text-white' :
                  isCurrent ? 'bg-blue-500 text-white' :
                  'bg-gray-300 text-gray-500'
                }`}>
                  {isCompleted ? (
                    <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5" />
                  ) : isCurrent ? (
                    <Loader className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                  ) : (
                    <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                  )}
                </div>
                
                <div className="flex-1">
                  <h3 className={`text-sm sm:text-base font-semibold ${
                    isCompleted ? 'text-green-700' :
                    isCurrent ? 'text-blue-700' :
                    'text-gray-500'
                  }`}>
                    {phase.label}
                  </h3>
                  
                  {/* Show data counts for relevant phases */}
                  {phase.key === 'business_personas' && dataCounts.business_personas > 0 && (
                    <p className="text-xs sm:text-sm text-gray-600 mt-1">
                      {dataCounts.business_personas} business personas
                    </p>
                  )}
                  {phase.key === 'dm_personas' && dataCounts.dm_personas > 0 && (
                    <p className="text-xs sm:text-sm text-gray-600 mt-1">
                      {dataCounts.dm_personas} decision maker personas
                    </p>
                  )}
                  {phase.key === 'business_discovery' && dataCounts.businesses > 0 && (
                    <p className="text-xs sm:text-sm text-gray-600 mt-1">
                      {dataCounts.businesses} businesses found
                    </p>
                  )}
                  {phase.key === 'decision_makers' && dataCounts.decision_makers > 0 && (
                    <p className="text-xs sm:text-sm text-gray-600 mt-1">
                      {dataCounts.decision_makers} decision makers mapped
                    </p>
                  )}
                  {phase.key === 'market_research' && dataCounts.market_insights > 0 && (
                    <p className="text-xs sm:text-sm text-gray-600 mt-1">
                      Market insights generated
                    </p>
                  )}
                </div>
                
                {isCurrent && (
                  <div className="ml-4">
                    <div className="flex space-x-1">
                      <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Error State */}
        {progress?.status === 'error' && !!progress?.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-center">
              <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
              <span className="text-red-700 font-medium">Processing Error</span>
            </div>
            <p className="text-red-600 text-sm mt-1">{String((progress.error as any)?.message || progress.error)}</p>
          </div>
        )}

        {/* Footer */}
        <div className="text-center">
          <p className="text-xs sm:text-sm text-gray-500">
            {currentPhase === 'completed' ? 
              'Analysis complete! Redirecting to results...' :
              currentPhase === 'failed' ?
              'There was an issue with the analysis. Please try again.' :
              'This may take 2-3 minutes. Please stay on this page.'
            }
          </p>
        </div>
      </div>
    </div>
  );
};

export default AgentProgressOverlay;