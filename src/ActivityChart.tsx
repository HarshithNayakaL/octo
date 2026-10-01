import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { Run } from "../shared/types";
echarts.use([BarChart, GridComponent, TooltipComponent, SVGRenderer]);
export default function ActivityChart({ runs }: { runs: Run[] }) {
  const element = useRef<HTMLDivElement>(null);
  const calendarDay = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
  const data = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const day = new Date();
        day.setDate(day.getDate() - 6 + i);
        const key = day.toLocaleDateString("en-CA", {
          timeZone: "Asia/Kolkata",
        });
        const dayRuns = runs.filter(
          (r) =>
            new Date(r.createdAt).toLocaleDateString("en-CA", {
              timeZone: "Asia/Kolkata",
            }) === key,
        );
        return {
          label: new Intl.DateTimeFormat("en-IN", {
            weekday: "short",
            timeZone: "Asia/Kolkata",
          }).format(day),
          live: dayRuns.filter((r) => r.mode === "live").length,
          demo: dayRuns.filter((r) => r.mode === "demo").length,
        };
      }),
    [calendarDay, runs.map((r) => r.id + ":" + r.mode).join(",")],
  );
  useEffect(() => {
    if (!element.current) return;
    const chart = echarts.init(element.current, undefined, { renderer: "svg" });
    chart.setOption({
      animation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      animationDuration: 400,
      grid: { left: 0, right: 0, top: 7, bottom: 22 },
      tooltip: {
        trigger: "axis",
        renderMode: "richText",
        axisPointer: { type: "none" },
      },
      xAxis: {
        type: "category",
        data: data.map((d) => d.label),
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: {
          fontFamily: "Epilogue Variable, sans-serif",
          fontSize: 11,
          color: "#64748b",
        },
      },
      yAxis: { type: "value", minInterval: 1, show: false },
      series: [
        {
          name: "Demo",
          type: "bar",
          stack: "runs",
          barWidth: 17,
          data: data.map((d) => d.demo),
          itemStyle: { color: "#cbd5e1", borderRadius: [4, 4, 0, 0] },
        },
        {
          name: "Live",
          type: "bar",
          stack: "runs",
          barWidth: 17,
          data: data.map((d) => d.live),
          itemStyle: { color: "#2563eb", borderRadius: [4, 4, 0, 0] },
        },
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [data]);
  return (
    <div
      ref={element}
      className="activity-chart"
      role="img"
      aria-label={
        "Research sessions started in the last seven days. " +
        data
          .map((d) => `${d.label}: ${d.live} live and ${d.demo} demo`)
          .join("; ")
      }
    />
  );
}
