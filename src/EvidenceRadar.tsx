import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { RadarChart } from "echarts/charts";
import { RadarComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { Lead } from "../shared/types";
echarts.use([RadarChart, RadarComponent, TooltipComponent, SVGRenderer]);

const known = (value: string) =>
  Boolean(value.trim()) &&
  !/^(unknown|n\/a|none|not found)\b/i.test(value.trim());

/** Share of records carrying each kind of evidence. Computed from the saved records only. */
export function evidenceProfile(leads: Lead[]) {
  const share = (test: (lead: Lead) => boolean) =>
    leads.length
      ? Math.round((leads.filter(test).length / leads.length) * 100)
      : 0;
  return [
    {
      name: "Good fit",
      value: share((l) => l.fit === "high" || l.fit === "medium"),
    },
    { name: "Fit evidence", value: share((l) => known(l.evidence)) },
    { name: "Needs", value: share((l) => known(l.needs)) },
    { name: "Decision maker", value: share((l) => known(l.decisionMaker)) },
    { name: "2+ sources", value: share((l) => l.sources.length >= 2) },
    { name: "Company size", value: share((l) => known(l.size)) },
  ];
}

export default function EvidenceRadar({ leads }: { leads: Lead[] }) {
  const element = useRef<HTMLDivElement>(null);
  const profile = evidenceProfile(leads);
  const signature = profile.map((p) => p.value).join(",");
  useEffect(() => {
    if (!element.current) return;
    const chart = echarts.init(element.current, undefined, { renderer: "svg" });
    chart.setOption({
      animationDuration: 700,
      tooltip: {
        trigger: "item",
        borderColor: "#dde3ef",
        textStyle: { color: "#424a5a", fontSize: 11 },
        formatter: () =>
          profile.map((p) => `${p.name}: <b>${p.value}%</b>`).join("<br/>"),
      },
      radar: {
        radius: element.current.clientWidth < 440 ? "48%" : "64%",
        center: ["50%", "53%"],
        splitNumber: 4,
        shape: "polygon",
        indicator: profile.map((p) => ({ name: p.name, max: 100 })),
        axisName: {
          color: "#7b7e88",
          fontSize: 10,
          fontFamily: "Inter Variable, sans-serif",
        },
        splitLine: { lineStyle: { color: "#e6e9f1" } },
        splitArea: { areaStyle: { color: ["#ffffff", "#f8f9fc"] } },
        axisLine: { lineStyle: { color: "#e6e9f1" } },
      },
      series: [
        {
          type: "radar",
          symbol: "circle",
          symbolSize: 7,
          itemStyle: { color: "#fff", borderColor: "#002fa7", borderWidth: 2 },
          lineStyle: { color: "#002fa7", width: 1.6 },
          areaStyle: {
            color: new echarts.graphic.RadialGradient(0.5, 0.5, 0.7, [
              { offset: 0, color: "rgba(0,47,167,0.04)" },
              { offset: 1, color: "rgba(0,47,167,0.22)" },
            ]),
          },
          emphasis: { lineStyle: { width: 2.2 } },
          data: [
            { value: profile.map((p) => p.value), name: "Evidence coverage" },
          ],
        },
      ],
    });
    const observer = new ResizeObserver(() => {
      chart.setOption({
        radar: {
          radius: (element.current?.clientWidth ?? 600) < 440 ? "48%" : "64%",
        },
      });
      chart.resize();
    });
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [signature]);
  return (
    <div
      ref={element}
      className="evidence-radar"
      role="img"
      aria-label={`Evidence coverage: ${profile.map((p) => `${p.name} ${p.value}%`).join(", ")}`}
    />
  );
}
