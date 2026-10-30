/** Tiny Prometheus text exposition: counters keyed by label set plus gauges computed at scrape time. */
type Labels = Record<string, string | number>;

function labelString(labels: Labels): string {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${String(v).replace(/["\\\n]/g, "_")}"`);
  return parts.length ? `{${parts.join(",")}}` : "";
}

export interface Gauge {
  name: string;
  help: string;
  samples: { labels: Labels; value: number }[];
}

export class Metrics {
  private readonly counters = new Map<string, { help: string; values: Map<string, number> }>();

  inc(name: string, help: string, labels: Labels = {}, by = 1): void {
    const counter = this.counters.get(name) ?? { help, values: new Map<string, number>() };
    const key = labelString(labels);
    counter.values.set(key, (counter.values.get(key) ?? 0) + by);
    this.counters.set(name, counter);
  }

  render(gauges: Gauge[]): string {
    const lines: string[] = [];
    for (const [name, c] of this.counters) {
      lines.push(`# HELP ${name} ${c.help}`, `# TYPE ${name} counter`);
      for (const [labels, value] of c.values) lines.push(`${name}${labels} ${value}`);
    }
    for (const g of gauges) {
      lines.push(`# HELP ${g.name} ${g.help}`, `# TYPE ${g.name} gauge`);
      for (const s of g.samples) lines.push(`${g.name}${labelString(s.labels)} ${s.value}`);
    }
    return lines.join("\n") + "\n";
  }
}
