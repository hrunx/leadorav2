import React, { useState, useEffect } from 'react';
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
  const [hasNavigatedEarly, setHasNavigatedEarly] = useState(false);

  const phases = [
    { key: 'starting', label: 'Initializing', icon: Search, color: 'text-blue-500' },
    { key: 'personas', label: 'Creating Personas', icon: Users, color: 'text-purple-500' },
    { key: 'businesses', label: 'Finding Businesses', icon: Building, color: 'text-green-500' },
    { key: 'decision_makers', label: 'Mapping Decision Makers', icon: UserCheck, color: 'text-orange-500' },
    { key: 'market_insights', label: 'Generating Insights', icon: TrendingUp, color: 'text-indigo-500' },
    { key: 'completed', label: 'Complete', icon: CheckCircle, color: 'text-emerald-500' }
  ];

  const pollProgress = async () => {
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
        setCurrentPhase(data.progress.phase);
        
        // Early navigation when personas and businesses are ready
        if (!hasNavigatedEarly && 
            data.data_counts.business_personas >= 5 && 
            data.data_counts.dm_personas >= 5 &&
            onEarlyNavigation) {
          setHasNavigatedEarly(true);
          setTimeout(() => {
            onEarlyNavigation();
          }, 1000);
        }
        
        if (data.progress.phase === 'completed' || data.progress.phase === 'failed') {
          setTimeout(() => {
            onComplete();
          }, 2000);
        }
      }
    } catch (error) {
      console.error('Error polling progress:', error);
    }
  };

  useEffect(() => {
    if (isVisible && searchId) {
      pollProgress();
      const interval = setInterval(pollProgress, 3000);
      return () => clearInterval(interval);
    }
  }, [isVisible, searchId]);

  if (!isVisible) return null;

  const getCurrentPhaseIndex = () => {
    return phases.findIndex(p => p.key === currentPhase);
  };

  const currentPhaseIndex = getCurrentPhaseIndex();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full mx-4 animate-in fade-in duration-300">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-8 h-8 text-white animate-pulse" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">AI Agents Working</h2>
          <p className="text-gray-600">Our AI agents are analyzing your market and finding leads</p>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-700">Overall Progress</span>
            <span className="text-sm font-medium text-gray-900">{progress?.progress_pct || 0}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div 
              className="bg-gradient-to-r from-blue-500 to-purple-600 h-3 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress?.progress_pct || 0}%` }}
            />
          </div>
        </div>

        {/* Phases */}
        <div className="space-y-4 mb-8">
          {phases.map((phase, index) => {
            const Icon = phase.icon;
            const isCompleted = index < currentPhaseIndex;
            const isCurrent = index === currentPhaseIndex;
            const isPending = index > currentPhaseIndex;
            
            return (
              <div key={phase.key} className={`flex items-center p-4 rounded-lg border-2 transition-all duration-300 ${
                isCompleted ? 'bg-green-50 border-green-200' :
                isCurrent ? 'bg-blue-50 border-blue-200 shadow-md' :
                'bg-gray-50 border-gray-200'
              }`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center mr-4 ${
                  isCompleted ? 'bg-green-500 text-white' :
                  isCurrent ? 'bg-blue-500 text-white' :
                  'bg-gray-300 text-gray-500'
                }`}>
                  {isCompleted ? (
                    <CheckCircle className="w-5 h-5" />
                  ) : isCurrent ? (
                    <Loader className="w-5 h-5 animate-spin" />
                  ) : (
                    <Icon className="w-5 h-5" />
                  )}
                </div>
                
                <div className="flex-1">
                  <h3 className={`font-semibold ${
                    isCompleted ? 'text-green-700' :
                    isCurrent ? 'text-blue-700' :
                    'text-gray-500'
                  }`}>
                    {phase.label}
                  </h3>
                  
                  {/* Show data counts for relevant phases */}
                  {phase.key === 'personas' && (dataCounts.business_personas > 0 || dataCounts.dm_personas > 0) && (
                    <p className="text-sm text-gray-600 mt-1">
                      {dataCounts.business_personas} business + {dataCounts.dm_personas} decision maker personas
                    </p>
                  )}
                  {phase.key === 'businesses' && dataCounts.businesses > 0 && (
                    <p className="text-sm text-gray-600 mt-1">
                      {dataCounts.businesses} businesses found
                    </p>
                  )}
                  {phase.key === 'decision_makers' && dataCounts.decision_makers > 0 && (
                    <p className="text-sm text-gray-600 mt-1">
                      {dataCounts.decision_makers} decision makers mapped
                    </p>
                  )}
                  {phase.key === 'market_insights' && dataCounts.market_insights > 0 && (
                    <p className="text-sm text-gray-600 mt-1">
                      Market insights generated
                    </p>
                  )}
                </div>
                
                {isCurrent && (
                  <div className="ml-4">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Error State */}
        {progress?.status === 'error' && progress?.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-center">
              <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
              <span className="text-red-700 font-medium">Processing Error</span>
            </div>
            <p className="text-red-600 text-sm mt-1">{progress.error.message}</p>
          </div>
        )}

        {/* Footer */}
        <div className="text-center">
          <p className="text-sm text-gray-500">
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