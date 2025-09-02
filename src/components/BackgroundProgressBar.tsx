import React, { useState, useEffect } from 'react';
import { X, CheckCircle, Clock, AlertCircle } from 'lucide-react';

interface BackgroundProgressBarProps {
  searchId: string | null;
  onClose?: () => void;
}

interface ProgressData {
  phase: string;
  progress_pct: number;
  data_counts: {
    businesses: number;
    business_personas: number;
    dm_personas: number;
    decision_makers: number;
    market_insights: number;
  };
}

const BackgroundProgressBar: React.FC<BackgroundProgressBarProps> = ({ searchId, onClose }) => {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!searchId) return;

    const checkProgress = async () => {
      try {
        const baseUrl = import.meta.env.MODE === 'development' ? 'http://localhost:8888' : window.location.origin;
        const response = await fetch(`${baseUrl}/.netlify/functions/check-progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ search_id: searchId })
        });
        
        if (response.ok) {
          const data = await response.json();
          setProgress(data);
          
          // Show progress bar if not completed and has some activity
          const shouldShow = data.progress?.phase !== 'completed' && 
                            (data.progress?.progress_pct > 0 || 
                             Object.values(data.data_counts || {}).some((count: any) => count > 0));
          setIsVisible(shouldShow);
          
          // Auto-hide when complete
          if (data.progress?.phase === 'completed') {
            setTimeout(() => {
              setIsVisible(false);
              onClose?.();
            }, 3000);
          }
        }
      } catch (error) {
        import('../lib/logger').then(({ default: logger }) => logger.warn('Error checking progress', { error: (error as any)?.message || error }))
          .catch(() => {});
      }
    };

    checkProgress();
    const interval = setInterval(checkProgress, 5000);
    return () => clearInterval(interval);
  }, [searchId, onClose]);

  if (!isVisible || !progress) return null;

  const { phase, progress_pct, data_counts } = progress;
  const isComplete = phase === 'completed';
  const isError = phase === 'failed' || phase === 'cancelled';

  const getPhaseIcon = () => {
    if (isComplete) return <CheckCircle className="w-4 h-4 text-green-500" />;
    if (isError) return <AlertCircle className="w-4 h-4 text-red-500" />;
    return <Clock className="w-4 h-4 text-blue-500" />;
  };

  const getPhaseText = () => {
    switch (phase) {
      case 'business_discovery': return 'Finding businesses...';
      case 'business_personas': return 'Generating personas...';
      case 'dm_personas': return 'Analyzing decision makers...';
      case 'market_research': return 'Researching market...';
      case 'completed': return 'Search complete!';
      case 'failed': return 'Search failed';
      case 'cancelled': return 'Search cancelled';
      default: return 'Processing...';
    }
  };

  return (
    <div className="fixed right-4 z-50 max-w-sm top-16 md:top-20">
      <div className={`bg-white rounded-lg shadow-lg border transition-all duration-300 ${
        isExpanded ? 'p-4' : 'p-3'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 flex-1">
            {getPhaseIcon()}
            <span className="text-sm font-medium text-gray-700 truncate">
              {getPhaseText()}
            </span>
            <span className="text-xs text-gray-500">
              {progress_pct}%
            </span>
          </div>
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
            >
              <div className={`text-gray-400 transition-transform duration-200 ${
                isExpanded ? 'rotate-180' : ''
              }`}>
                ▼
              </div>
            </button>
            <button
              onClick={() => setIsVisible(false)}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-2 w-full bg-gray-200 rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all duration-500 ${
              isComplete ? 'bg-green-500' : isError ? 'bg-red-500' : 'bg-blue-500'
            }`}
            style={{ width: `${Math.min(100, Math.max(0, progress_pct))}%` }}
          />
        </div>

        {/* Expanded details */}
        {isExpanded && (
          <div className="mt-3 space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Businesses:</span>
                <span className="font-medium">{data_counts.businesses}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Personas:</span>
                <span className="font-medium">{data_counts.business_personas}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Decision Makers:</span>
                <span className="font-medium">{data_counts.decision_makers}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Insights:</span>
                <span className="font-medium">{data_counts.market_insights}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BackgroundProgressBar;
