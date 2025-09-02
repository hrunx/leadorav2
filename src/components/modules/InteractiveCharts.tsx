import React, { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
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
  enableZoom?: boolean;
  onPointClick?: (point: ChartDataPoint, index: number) => void;
}

export const InteractiveLineChart: React.FC<InteractiveLineChartProps> = ({
  title,
  data,
  height = 300,
  enableZoom = true,
  onPointClick
}) => {
  const [zoomLevel, setZoomLevel] = useState(1);

  const handleZoom = (direction: 'in' | 'out') => {
    if (!enableZoom) return;
    if (direction === 'in' && zoomLevel < 3) setZoomLevel(prev => prev * 1.2);
    else if (direction === 'out' && zoomLevel > 0.5) setZoomLevel(prev => prev / 1.2);
  };

  const option: EChartsOption = useMemo(() => ({
    tooltip: { trigger: 'axis', backgroundColor: '#111827', textStyle: { color: '#fff' } },
    grid: { left: 40, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: data.map(d => d.label), boundaryGap: false, axisLine: { lineStyle: { color: '#CBD5E1' } }, axisLabel: { color: '#64748B' } },
    yAxis: { type: 'value', axisLine: { lineStyle: { color: '#CBD5E1' } }, splitLine: { lineStyle: { color: '#E5E7EB' } }, axisLabel: { color: '#64748B' } },
    series: [
      {
        type: 'line',
        smooth: true,
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [ { offset: 0, color: 'rgba(59,130,246,0.35)' }, { offset: 1, color: 'rgba(59,130,246,0.05)' } ]
          }
        },
        lineStyle: { color: '#3b82f6', width: 2 },
        itemStyle: { color: '#3b82f6' },
        data: data.map(d => d.value)
      }
    ]
  }), [data]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <div className="flex items-center space-x-2">
          {enableZoom && (
            <>
              <button onClick={() => handleZoom('out')} className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded" disabled={zoomLevel <= 0.5}><ZoomOut className="w-4 h-4" /></button>
              <button onClick={() => handleZoom('in')} className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded" disabled={zoomLevel >= 3}><ZoomIn className="w-4 h-4" /></button>
            </>
          )}
          <button className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"><Download className="w-4 h-4" /></button>
          <button className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"><Share2 className="w-4 h-4" /></button>
        </div>
      </div>
      <ReactECharts
        option={option}
        style={{ height }}
        notMerge
        lazyUpdate
        onEvents={{ click: (e: any) => {
          const idx = typeof e?.dataIndex === 'number' ? e.dataIndex : (typeof e?.seriesIndex === 'number' ? e.seriesIndex : undefined);
          if (typeof idx === 'number' && onPointClick) {
            const point = data[idx];
            if (point) onPointClick(point, idx);
          }
        } }}
      />
    </div>
  );
};

interface InteractiveBarChartProps {
  title: string;
  data: ChartDataPoint[];
  height?: number;
  showValues?: boolean;
  onBarClick?: (point: ChartDataPoint, index: number) => void;
  valueFormatter?: (n: number) => string;
}

export const InteractiveBarChart: React.FC<InteractiveBarChartProps> = ({
  title,
  data,
  height = 300,
  showValues = true,
  onBarClick,
  valueFormatter
}) => {
  const formatShort = (n: number) => {
    if (!Number.isFinite(n)) return '0';
    if (n >= 1_000_000_000) return `${(n/1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n/1_000).toFixed(1)}K`;
    return `${n.toFixed(0)}`;
  };
  const option: EChartsOption = useMemo(() => ({
    tooltip: { trigger: 'item' },
    grid: { left: 100, right: 20, top: 10, bottom: 10, containLabel: true },
    xAxis: { type: 'value', axisLine: { lineStyle: { color: '#CBD5E1' } }, splitLine: { lineStyle: { color: '#E5E7EB' } }, axisLabel: { color: '#64748B', formatter: (val: any) => (valueFormatter ? valueFormatter(Number(val)) : formatShort(Number(val))) } },
    yAxis: { type: 'category', data: data.map(d => d.label), axisLine: { lineStyle: { color: '#CBD5E1' } }, axisLabel: { color: '#64748B' } },
    series: [
      {
        type: 'bar',
        data: data.map((d, i) => ({ value: d.value, itemStyle: { color: d.color || `hsl(${210 + i * 15}, 70%, 50%)` } })),
        label: { show: showValues, position: 'right', color: '#374151', formatter: (obj: any) => (valueFormatter ? valueFormatter(Number(obj?.value)) : formatShort(Number(obj?.value))) },
        emphasis: { focus: 'series' },
        barWidth: 14,
        itemStyle: { borderRadius: [4, 6, 6, 4] }
      }
    ]
  }), [data, showValues, valueFormatter]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <div className="flex items-center space-x-2">
          <button className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"><Download className="w-4 h-4" /></button>
          <button className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"><Share2 className="w-4 h-4" /></button>
        </div>
      </div>
      <ReactECharts
        option={option}
        style={{ height }}
        notMerge
        lazyUpdate
        onEvents={{ click: (e: any) => {
          const idx = e?.dataIndex;
          if (typeof idx === 'number' && onBarClick) onBarClick({ label: data[idx].label, value: data[idx].value }, idx);
        } }}
      />
    </div>
  );
}

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
  const option: EChartsOption = useMemo(() => ({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: showLegend ? { orient: 'vertical', right: 0, top: 'middle' } : undefined,
    series: [
      {
        type: 'pie',
        radius: ['55%', '80%'],
        center: ['40%', '50%'],
        label: { show: false },
        emphasis: { scale: true },
        data: data.map((d, i) => ({ name: d.label, value: d.value, itemStyle: { color: d.color || `hsl(${i * 45},70%,50%)` } }))
      }
    ],
    graphic: [
      {
        type: 'text', left: '40%', top: '50%', style: { text: (() => {
          const total = data.reduce((s, p) => s + (Number(p.value) || 0), 0);
          if (total >= 1_000_000_000) return `$${(total/1_000_000_000).toFixed(1)}B`;
          if (total >= 1_000_000) return `$${(total/1_000_000).toFixed(1)}M`;
          if (total >= 1_000) return `$${(total/1_000).toFixed(1)}K`;
          return `$${total.toFixed(0)}`;
        })(), fill: '#0f172a', fontWeight: 700, fontSize: 16, textAlign: 'center' }
      },
      { type: 'text', left: '40%', top: '58%', style: { text: 'Total', fill: '#64748B', fontSize: 10, textAlign: 'center' } }
    ]
  }), [data, showLegend]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <div className="flex items-center space-x-2">
          <button className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"><Download className="w-4 h-4" /></button>
          <button className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"><Share2 className="w-4 h-4" /></button>
        </div>
      </div>
      <ReactECharts option={option} style={{ height: size + 40 }} notMerge lazyUpdate onEvents={{ click: (e: any) => {
        const idx = e?.dataIndex; if (typeof idx === 'number' && onSliceClick) onSliceClick({ label: data[idx].label, value: data[idx].value }, idx);
      } }} />
    </div>
  );
};

interface DrilldownPanelProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export const DrilldownPanel: React.FC<DrilldownPanelProps> = ({ title, isOpen, onToggle, children }) => {
  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 rounded-t-xl">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {isOpen ? (<ChevronUp className="w-5 h-5 text-gray-500" />) : (<ChevronDown className="w-5 h-5 text-gray-500" />)}
      </button>
      {isOpen && (<div className="p-4 pt-0 border-t border-gray-100">{children}</div>)}
    </div>
  );
};

// --- Additional premium charts ---

export const RadarChart: React.FC<{ title: string; indicators: { name: string; max?: number }[]; values: number[]; height?: number }>
  = ({ title, indicators, values, height = 300 }) => {
  const option: EChartsOption = useMemo(() => ({
    tooltip: {},
    radar: {
      indicator: indicators,
      splitLine: { lineStyle: { color: ['#e5e7eb'] } },
      splitArea: { areaStyle: { color: ['#f9fafb', '#f3f4f6'] } },
      axisLine: { lineStyle: { color: '#cbd5e1' } }
    },
    series: [{ type: 'radar', areaStyle: { opacity: 0.2 }, lineStyle: { width: 2 }, data: [{ value: values, name: 'Market' }] }]
  }), [indicators, values]);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6"><h3 className="text-lg font-semibold text-gray-900">{title}</h3></div>
      <ReactECharts option={option} style={{ height }} notMerge lazyUpdate />
    </div>
  );
};

export const FunnelChart: React.FC<{ title: string; data: ChartDataPoint[]; height?: number }>
  = ({ title, data, height = 300 }) => {
  const option: EChartsOption = useMemo(() => ({
    tooltip: { trigger: 'item', formatter: '{b}: {c}' },
    series: [{
      type: 'funnel',
      left: '10%',
      top: 10,
      bottom: 10,
      width: '80%',
      minSize: '10%',
      maxSize: '80%',
      sort: 'descending',
      label: { show: true, formatter: '{b}: {c}' },
      data: data.map((d, i) => ({ name: d.label, value: d.value, itemStyle: { color: d.color || `hsl(${200 + i * 25},65%,55%)` } }))
    }]
  }), [data]);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6"><h3 className="text-lg font-semibold text-gray-900">{title}</h3></div>
      <ReactECharts option={option} style={{ height }} notMerge lazyUpdate />
    </div>
  );
};

export const ScatterChart: React.FC<{ title: string; points: { name: string; x: number; y: number; size?: number; color?: string }[]; xLabel: string; yLabel: string; height?: number }>
  = ({ title, points, xLabel, yLabel, height = 320 }) => {
  const option: EChartsOption = useMemo(() => ({
    tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}<br/>${xLabel}: ${p.value[0]}%<br/>${yLabel}: ${p.value[1]}%` },
    grid: { left: 40, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'value', name: xLabel, nameLocation: 'middle', nameGap: 25, min: 0, max: 100, splitLine: { lineStyle: { color: '#e5e7eb' } } },
    yAxis: { type: 'value', name: yLabel, nameLocation: 'end', min: -20, max: 50, splitLine: { lineStyle: { color: '#e5e7eb' } } },
    series: [
      {
        type: 'scatter',
        symbolSize: (val: any) => Math.max(8, Math.min(24, (val[2] || 10))),
        data: points.map(p => ({ name: p.name, value: [p.x, p.y, p.size || 10], itemStyle: { color: p.color } })),
        emphasis: { focus: 'series' }
      }
    ]
  }), [points, xLabel, yLabel]);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6"><h3 className="text-lg font-semibold text-gray-900">{title}</h3></div>
      <ReactECharts option={option} style={{ height }} notMerge lazyUpdate />
    </div>
  );
};

export const PolarBarChart: React.FC<{ title: string; data: ChartDataPoint[]; height?: number }>
  = ({ title, data, height = 320 }) => {
  const option: EChartsOption = useMemo(() => ({
    angleAxis: { type: 'category', data: data.map(d => d.label) },
    radiusAxis: {},
    polar: {},
    tooltip: { trigger: 'item' },
    series: [{ type: 'bar', coordinateSystem: 'polar', data: data.map((d, i) => ({ value: d.value, itemStyle: { color: d.color || `hsl(${i * 50},70%,50%)` } })) }]
  }), [data]);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6"><h3 className="text-lg font-semibold text-gray-900">{title}</h3></div>
      <ReactECharts option={option} style={{ height }} notMerge lazyUpdate />
    </div>
  );
};

export const CandlestickChart: React.FC<{ title: string; data: { label: string; open: number; close: number; low: number; high: number }[]; height?: number }>
  = ({ title, data, height = 320 }) => {
  const option: EChartsOption = useMemo(() => ({
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: data.map(d => d.label), boundaryGap: true },
    yAxis: { scale: true, splitLine: { lineStyle: { color: '#e5e7eb' } } },
    series: [{ type: 'candlestick', data: data.map(d => [d.open, d.close, d.low, d.high]) }]
  }), [data]);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6"><h3 className="text-lg font-semibold text-gray-900">{title}</h3></div>
      <ReactECharts option={option} style={{ height }} notMerge lazyUpdate />
    </div>
  );
};
