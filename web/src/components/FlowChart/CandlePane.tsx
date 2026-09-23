"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, FillMark } from "@/lib/ohlc";

export type EntryLine = {
  price: number;
  side: "long" | "short";
};

type Props = {
  candles: Candle[];
  marks: FillMark[];
  entry: EntryLine | null;
  rangeKey: string;
  visibleBars: number;
  secondsVisible: boolean;
  formatPrice: (n: number) => string;
};

type ChartColors = {
  background: string;
  text: string;
  grid: string;
  border: string;
  up: string;
  down: string;
  buy: string;
  sell: string;
};

function chartColors(el: HTMLElement): ChartColors {
  const css = getComputedStyle(el);
  const value = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: value("--panel", "#ffffff"),
    text: value("--chart-text", "#666666"),
    grid: value("--grid", "#e5e5e5"),
    border: value("--border", "#000000"),
    up: value("--chart-up", "#000000"),
    down: value("--chart-down", "#ffffff"),
    buy: value("--buy", "#087d20"),
    sell: value("--sell", "#b42318"),
  };
}

function asTime(sec: number): UTCTimestamp {
  return sec as UTCTimestamp;
}

function toBars(rows: Candle[]): CandlestickData<Time>[] {
  return rows.map((c) => ({
    time: asTime(c.time),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

function toMarkers(rows: FillMark[], colors: ChartColors): SeriesMarker<Time>[] {
  return rows.map((m) => ({
    time: asTime(m.time),
    position: m.side === "buy" ? "belowBar" : "aboveBar",
    shape: m.side === "buy" ? "arrowUp" : "arrowDown",
    color: m.side === "buy" ? colors.buy : colors.sell,
    size: 0.8,
  }));
}

function stemOf(rows: Candle[]): string {
  if (!rows.length) return "empty";
  return `${rows[0]!.time}`;
}

function showLatest(chart: IChartApi | null, count: number, visibleBars: number) {
  if (!chart || count <= 0) return;
  const to = count + 1;
  const from = Math.max(-1, to - visibleBars);
  chart.timeScale().setVisibleLogicalRange({ from, to });
}

export default function CandlePane({
  candles,
  marks,
  entry,
  rangeKey,
  visibleBars,
  secondsVisible,
  formatPrice,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const entryLineRef = useRef<IPriceLine | null>(null);
  const stemRef = useRef("");
  const rangeRef = useRef("");
  const [themeRevision, setThemeRevision] = useState(0);
  const formatRef = useRef(formatPrice);
  formatRef.current = formatPrice;

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeRevision((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const colors = chartColors(el);
    const chart = createChart(el, {
      width: Math.max(1, el.clientWidth),
      height: Math.max(1, el.clientHeight),
      layout: {
        background: { type: ColorType.Solid, color: colors.background },
        textColor: colors.text,
        fontFamily: "IBM Plex Mono, ui-monospace, monospace",
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: colors.border, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: colors.border,
        timeVisible: true,
        secondsVisible,
        shiftVisibleRangeOnNewBar: true,
      },
      localization: { priceFormatter: (p: number) => formatRef.current(p) },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: colors.up,
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.up,
      wickUpColor: colors.up,
      wickDownColor: colors.up,
    });
    const markers = createSeriesMarkers(series, []);
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      chart.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
    });
    ro.observe(el);
    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = markers;
    return () => {
      ro.disconnect();
      markers.detach();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      entryLineRef.current = null;
      stemRef.current = "";
      rangeRef.current = "";
    };
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!el || !chart || !series) return;
    const colors = chartColors(el);
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: colors.background }, textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.border },
      timeScale: { borderColor: colors.border },
    });
    series.applyOptions({
      upColor: colors.up,
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.up,
      wickUpColor: colors.up,
      wickDownColor: colors.up,
    });
  }, [themeRevision]);

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { secondsVisible, timeVisible: true } });
  }, [secondsVisible]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const bars = toBars(candles);
    const stem = stemOf(candles);
    if (!bars.length) {
      series.setData([]);
      stemRef.current = stem;
      return;
    }
    const stemChanged = stemRef.current !== stem;
    if (!stemChanged && stem) {
      series.update(bars[bars.length - 1]!);
    } else {
      series.setData(bars);
      stemRef.current = stem;
    }
    if (rangeRef.current !== rangeKey || stemChanged) {
      rangeRef.current = rangeKey;
      showLatest(chartRef.current, bars.length, visibleBars);
    }
  }, [candles, rangeKey, visibleBars]);

  useEffect(() => {
    const el = hostRef.current;
    if (el) markersRef.current?.setMarkers(toMarkers(marks, chartColors(el)));
  }, [marks, themeRevision]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (!entry || !(entry.price > 0)) {
      if (entryLineRef.current) {
        series.removePriceLine(entryLineRef.current);
        entryLineRef.current = null;
      }
      return;
    }
    const colors = chartColors(hostRef.current ?? document.documentElement);
    const next = {
      price: entry.price,
      color: entry.side === "long" ? colors.buy : colors.sell,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: "entry",
    };
    if (entryLineRef.current) {
      entryLineRef.current.applyOptions(next);
      return;
    }
    entryLineRef.current = series.createPriceLine(next);
  }, [entry, themeRevision]);

  return <div ref={hostRef} className="lwc-host" style={{ position: "absolute", inset: 0 }} />;
}
