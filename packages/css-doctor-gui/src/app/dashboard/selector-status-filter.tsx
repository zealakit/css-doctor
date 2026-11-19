import type { SelectorExplorerStatus } from "@shared/selector-explorer";

export type SelectorStatusFilterValue = SelectorExplorerStatus | "all";

type SelectorStatusFilterProps = {
  value: SelectorStatusFilterValue;
  onChange: (value: SelectorStatusFilterValue) => void;
};

const OPTIONS: Array<{ value: SelectorStatusFilterValue; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "used", label: "Used" },
  { value: "unused", label: "Unused" },
  { value: "partial", label: "Partial" },
  { value: "unknown", label: "Unknown" },
];

export function SelectorStatusFilter({
  value,
  onChange,
}: SelectorStatusFilterProps) {
  return (
    <div className="dashboard__kind-filter">
      <label className="visually-hidden" htmlFor="selector-status-filter">
        Filter by usage status
      </label>
      <select
        id="selector-status-filter"
        value={value}
        onChange={(event) =>
          onChange(event.target.value as SelectorStatusFilterValue)
        }
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
