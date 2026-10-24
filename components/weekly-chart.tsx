"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface WeekPoint {
  week: string;
  rate: number | null;
  n: number;
}

export function WeeklyChart({ data }: { data: WeekPoint[] }) {
  return (
    <figure className="flex flex-col gap-2">
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data.map((d) => ({
              ...d,
              pct: d.rate === null ? null : Math.round(d.rate * 100),
            }))}
            margin={{ top: 8, right: 12, bottom: 0, left: -12 }}
          >
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="week"
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              unit="%"
            />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 12,
              }}
              formatter={(value, _name, item) => [
                `${value}% of ${(item.payload as WeekPoint).n}`,
                "Agreement",
              ]}
            />
            <Line
              type="monotone"
              dataKey="pct"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={{ r: 3 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-muted-foreground text-xs">
        Weekly agreement (weeks start Monday, NZ time). Hover a point for its
        sample size.
      </figcaption>
    </figure>
  );
}
