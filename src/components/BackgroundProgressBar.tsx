import { useState, useEffect, useCallback } from 'react';
import logger from '../lib/logger';
import { Loader, CheckCircle, AlertCircle } from 'lucide-react';

interface BackgroundProgressBarProps {
  searchId: string;
  isVisible: boolean;
  onComplete: () => void;
}

interface ProgressData {
  phase: string;
  progress_pct: number;
  status: string;
  error?: unknown;
}

interface DataCounts {
  business_personas: number;
  businesses: number;
  dm_personas: number;
  decision_makers: number;
  market_insights: number;
}

const BackgroundProgressBar: React.FC<BackgroundProgressBarProps> = ({
  searchId,
  isVisible,
  onComplete
}) => {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [dataCounts, setDataCounts] = useState<DataCounts>({
    business_personas: 0,
    businesses: 0,
    dm_personas: 0,
    decision_makers: 0,
    market_insights: 0
  });
  const [currentPhase, setCurrentPhase] = useState<string>('starting');

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

        // Normalize backend phase aliases
        const rawPhase = data?.progress?.phase || 'starting';
        const normalizedPhase = (() => {
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
        const pct = Number(data?.progress?.progress_pct || 0);
        // Derive a UI phase using counts and progress percent
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

        if (data.progress.phase === 'completed' || data.progress.phase === 'failed') {
          setTimeout(() => { onComplete(); }, 3000);
        }
      }
    } catch (error: any) {
      logger.warn('Error polling progress (background bar)', { error: error?.message || String(error) });
    }
  }, [onComplete, searchId]);

  useEffect(() => {
    if (isVisible && searchId) {
      pollProgress();
      const interval = setInterval(pollProgress, 5000);
      return () => clearInterval(interval);
    }
  }, [isVisible, searchId, pollProgress]);

  if (!isVisible || !progress) return null;

  const getStatusText = () => {
    const phase = currentPhase || progress.phase;
    const map: Record<string, string> = {
      starting: 'Starting analysis...',
      business_personas: dataCounts.businesses > 0 || dataCounts.dm_personas > 0 ? 'Finding businesses...' : 'Generating business personas...',
      dm_personas: 'Generating decision maker personas...',
      business_discovery: 'Finding businesses...',
      decision_makers: 'Mapping decision makers...',
      market_research: dataCounts.market_insights > 0 ? 'Insights ready' : 'Generating market research...',
      market_insights: 'Generating market insights...',
      completed: 'Analysis complete!',
      failed: 'Analysis failed'
    };
    return map[phase] || 'Processing...';
  };

  const getStatusIcon = () => {
    if (progress.phase === 'completed') {
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    } else if (progress.phase === 'failed') {
      return <AlertCircle className="w-4 h-4 text-red-500" />;
    } else {
      return <Loader className="w-4 h-4 text-blue-500 animate-spin" />;
    }
  };

  return (
    <div className="fixed top-4 right-4 bg-white rounded-lg shadow-lg border border-gray-200 p-4 max-w-sm z-40">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          {getStatusIcon()}
          <span className="text-sm font-medium text-gray-900">{getStatusText()}</span>
        </div>
        <span className="text-xs text-gray-500">{progress.progress_pct}%</span>
      </div>
      
      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
        <div 
          className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progress.progress_pct}%` }}
        />
      </div>

      {/* Data counts */}
      <div className="grid grid-cols-3 gap-2 text-xs text-gray-600">
        <div className="text-center">
          <div className="font-semibold text-gray-900">{dataCounts.businesses}</div>
          <div>Businesses</div>
        </div>
        <div className="text-center">
          <div className="font-semibold text-gray-900">{dataCounts.decision_makers}</div>
          <div>Contacts</div>
        </div>
        <div className="text-center">
          <div className="font-semibold text-gray-900">{dataCounts.market_insights}</div>
          <div>Insights</div>
        </div>
      </div>

      {progress.phase === 'completed' && (
        <div className="mt-2 text-xs text-green-600 font-medium">
          ✓ Your lead generation is complete!
        </div>
      )}

      {progress.phase === 'failed' && (
        <div className="mt-2 text-xs text-red-600">
          ⚠ There was an issue. Please try again.
        </div>
      )}
    </div>
  );
};

export default BackgroundProgressBar;