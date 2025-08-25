import React, { useState, useMemo } from 'react';
import { ZoomIn, ZoomOut, Download, Share2, ChevronDown, ChevronUp } from 'lucide-react';

interface ChartDataPoint {
  label: string;
  value: number;
  metadata?: any;
  color?: string;
}

interface InteractiveLineChartProps {
  title: string;
  data: ChartDataPoint[];
  height?: number;
  showGrid?: boolean;
  showTooltips?: boolean;
  enableZoom?: boolean;
  onPointClick?: (point: ChartDataPoint, index: number) => void;
}

export const InteractiveLineChart: React.FC<InteractiveLineChartProps> = ({
  title,
  data,
  height = 300,
  showGrid = true,
  showTooltips = true,
  enableZoom = true,
  onPointClick
}) => {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);
  // Selected range reserved for future zoom interactions; omit state to avoid unused warnings

  const chartData = useMemo(() => {
    if (!data.length) return [];
    
    const maxValue = Math.max(...data.map(d => d.value));
    const minValue = Math.min(...data.map(d => d.value));
    const range = maxValue - minValue || 1;
    
    return data.map((point, index) => ({
      ...point,
      x: (index / (data.length - 1)) * 100,
      y: ((maxValue - point.value) / range) * 80 + 10 // 10% padding
    }));
  }, [data]);

  const pathData = useMemo(() => {
    if (chartData.length < 2) return '';
    
    const commands = chartData.map((point, index) => 
      `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
    );
    
    return commands.join(' ');
  }, [chartData]);

  const areaPathData = useMemo(() => {
    if (chartData.length < 2) return '';
    
    const linePath = pathData;
    const firstPoint = chartData[0];
    const lastPoint = chartData[chartData.length - 1];
    
    return `${linePath} L ${lastPoint.x} 90 L ${firstPoint.x} 90 Z`;
  }, [pathData, chartData]);

  const handleZoom = (direction: 'in' | 'out') => {
    if (!enableZoom) return;
    
    if (direction === 'in' && zoomLevel < 3) {
      setZoomLevel(prev => prev * 1.2);
    } else if (direction === 'out' && zoomLevel > 0.5) {
      setZoomLevel(prev => prev / 1.2);
    }
  };

  const handlePointClick = (point: ChartDataPoint, index: number) => {
    if (onPointClick) {
      onPointClick(point, index);
    }
  };

  const formatValue = (value: number): string => {
    if (value >= 1000000000) {
      return `$${(value / 1000000000).toFixed(1)}B`;
    } else if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(1)}K`;
    }
    return `$${value.toFixed(0)}`;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <div className="flex items-center space-x-2">
          {enableZoom && (
            <>
              <button
                onClick={() => handleZoom('out')}
                className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                disabled={zoomLevel <= 0.5}
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleZoom('in')}
                className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                disabled={zoomLevel >= 3}
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </>
          )}
          <button className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded">
            <Download className="w-4 h-4" />
          </button>
          <button className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded">
            <Share2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="relative" style={{ height }}>
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="overflow-visible"
          style={{ transform: `scale(${zoomLevel})` }}
        >
          {/* Grid lines */}
          {showGrid && (
            <g className="opacity-20">
              {[0, 25, 50, 75, 100].map(y => (
                <line
                  key={y}
                  x1="0"
                  y1={y}
                  x2="100"
                  y2={y}
                  stroke="#e5e7eb"
                  strokeWidth="0.5"
                />
              ))}
              {chartData.map((_, index) => {
                const x = (index / (chartData.length - 1)) * 100;
                return (
                  <line
                    key={index}
                    x1={x}
                    y1="0"
                    x2={x}
                    y2="100"
                    stroke="#e5e7eb"
                    strokeWidth="0.3"
                  />
                );
              })}
            </g>
          )}

          {/* Area fill */}
          <defs>
            <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
            </linearGradient>
          </defs>
          
          {areaPathData && (
            <path
              d={areaPathData}
              fill="url(#areaGradient)"
              className="transition-all duration-300"
            />
          )}

          {/* Line */}
          {pathData && (
            <path
              d={pathData}
              fill="none"
              stroke="#3b82f6"
              strokeWidth="2"
              className="transition-all duration-300"
            />
          )}

          {/* Data points */}
          {chartData.map((point, index) => (
            <g key={index}>
              <circle
                cx={point.x}
                cy={point.y}
                r={hoveredPoint === index ? "3" : "2"}
                fill="#3b82f6"
                stroke="white"
                strokeWidth="2"
                className="cursor-pointer transition-all duration-200"
                onMouseEnter={() => setHoveredPoint(index)}
                onMouseLeave={() => setHoveredPoint(null)}
                onClick={() => handlePointClick(point, index)}
              />
              
              {/* Tooltip */}
              {showTooltips && hoveredPoint === index && (
                <g>
                  <foreignObject
                    x={point.x - 30}
                    y={point.y - 40}
                    width="60"
                    height="30"
                    className="pointer-events-none"
                  >
                    <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 text-center">
                      <div className="font-medium">{formatValue(point.value)}</div>
                      <div className="text-gray-300">{point.label}</div>
                    </div>
                  </foreignObject>
                </g>
              )}
            </g>
          ))}
        </svg>
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
        <span>{chartData[0]?.label}</span>
        <span>{chartData[chartData.length - 1]?.label}</span>
      </div>
    </div>
  );
};

interface InteractiveBarChartProps {
  title: string;
  data: ChartDataPoint[];
  height?: number;
  horizontal?: boolean;
  showValues?: boolean;
  onBarClick?: (point: ChartDataPoint, index: number) => void;
}

export const InteractiveBarChart: React.FC<InteractiveBarChartProps> = ({
  title,
  data,
  height = 300,
  horizontal: _horizontal = false,
  showValues = true,
  onBarClick
}) => {
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);

  const chartData = useMemo(() => {
    if (!data.length) return [];
    
    const maxValue = Math.max(...data.map(d => d.value));
    
    return data.map((point, index) => ({
      ...point,
      percentage: (point.value / maxValue) * 100,
      color: point.color || `hsl(${210 + index * 15}, 70%, 50%)`
    }));
  }, [data]);

  const formatValue = (value: number): string => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toString();
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <div className="flex items-center space-x-2">
          <button className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded">
            <Download className="w-4 h-4" />
          </button>
          <button className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded">
            <Share2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="space-y-4" style={{ height }}>
        {chartData.map((point, index) => (
          <div
            key={index}
            className="relative cursor-pointer group"
            onMouseEnter={() => setHoveredBar(index)}
            onMouseLeave={() => setHoveredBar(null)}
            onClick={() => onBarClick?.(point, index)}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-gray-700">{point.label}</span>
              {showValues && (
                <span className="text-sm text-gray-500">{formatValue(point.value)}</span>
              )}
            </div>
            
            <div className="relative h-6 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${point.percentage}%`,
                  backgroundColor: point.color,
                  opacity: hoveredBar === index ? 0.8 : 1,
                  transform: hoveredBar === index ? 'scaleY(1.1)' : 'scaleY(1)'
                }}
              />
              
              {/* Hover effect */}
              {hoveredBar === index && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-medium text-white">
                    {point.percentage.toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

interface InteractivePieChartProps {
  title: string;
  data: ChartDataPoint[];
  size?: number;
  showLegend?: boolean;
  onSliceClick?: (point: ChartDataPoint, index: number) => void;
}

export const InteractivePieChart: React.FC<InteractivePieChartProps> = ({
  title,
  data,
  size = 200,
  showLegend = true,
  onSliceClick
}) => {
  const [hoveredSlice, setHoveredSlice] = useState<number | null>(null);

  const chartData = useMemo(() => {
    if (!data.length) return [];
    
    const total = data.reduce((sum, point) => sum + point.value, 0);
    let cumulativeAngle = 0;
    
    return data.map((point, index) => {
      const percentage = (point.value / total) * 100;
      const angle = (point.value / total) * 360;
      const startAngle = cumulativeAngle;
      const endAngle = cumulativeAngle + angle;
      
      cumulativeAngle += angle;
      
      return {
        ...point,
        percentage,
        startAngle,
        endAngle,
        color: point.color || `hsl(${index * 45}, 70%, 50%)`
      };
    });
  }, [data]);

  const createArcPath = (centerX: number, centerY: number, radius: number, startAngle: number, endAngle: number) => {
    const start = polarToCartesian(centerX, centerY, radius, endAngle);
    const end = polarToCartesian(centerX, centerY, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    
    return [
      "M", centerX, centerY,
      "L", start.x, start.y,
      "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y,
      "Z"
    ].join(" ");
  };

  const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
    const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
    return {
      x: centerX + (radius * Math.cos(angleInRadians)),
      y: centerY + (radius * Math.sin(angleInRadians))
    };
  };

  const centerX = size / 2;
  const centerY = size / 2;
  const radius = size / 2 - 20;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <div className="flex items-center space-x-2">
          <button className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded">
            <Download className="w-4 h-4" />
          </button>
          <button className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded">
            <Share2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-center space-x-8">
        {/* Chart */}
        <div className="relative">
          <svg width={size} height={size} className="transform -rotate-90">
            {chartData.map((point, index) => (
              <path
                key={index}
                d={createArcPath(centerX, centerY, radius, point.startAngle, point.endAngle)}
                fill={point.color}
                stroke="white"
                strokeWidth="2"
                className="cursor-pointer transition-all duration-200"
                style={{
                  filter: hoveredSlice === index ? 'brightness(1.1)' : 'none',
                  transform: hoveredSlice === index ? 'scale(1.05)' : 'scale(1)',
                  transformOrigin: `${centerX}px ${centerY}px`
                }}
                onMouseEnter={() => setHoveredSlice(index)}
                onMouseLeave={() => setHoveredSlice(null)}
                onClick={() => onSliceClick?.(point, index)}
              />
            ))}
          </svg>
          
          {/* Center text */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">
                {data.reduce((sum, point) => sum + point.value, 0)}
              </div>
              <div className="text-sm text-gray-500">Total</div>
            </div>
          </div>
        </div>

        {/* Legend */}
        {showLegend && (
          <div className="space-y-2">
            {chartData.map((point, index) => (
              <div
                key={index}
                className="flex items-center space-x-2 cursor-pointer"
                onMouseEnter={() => setHoveredSlice(index)}
                onMouseLeave={() => setHoveredSlice(null)}
                onClick={() => onSliceClick?.(point, index)}
              >
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: point.color }}
                />
                <span className="text-sm text-gray-700">{point.label}</span>
                <span className="text-sm text-gray-500">({point.percentage.toFixed(1)}%)</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface DrilldownPanelProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export const DrilldownPanel: React.FC<DrilldownPanelProps> = ({
  title,
  isOpen,
  onToggle,
  children
}) => {
  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 rounded-t-xl"
      >
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {isOpen ? (
          <ChevronUp className="w-5 h-5 text-gray-500" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-500" />
        )}
      </button>
      
      {isOpen && (
        <div className="p-4 pt-0 border-t border-gray-100">
          {children}
        </div>
      )}
    </div>
  );
};
