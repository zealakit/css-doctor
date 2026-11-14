import type { SelectorExplorerCategory } from "@shared/selector-explorer";

export type SelectorKindFilterValue = SelectorExplorerCategory | "all";

type SelectorKindFilterProps = {
  value: SelectorKindFilterValue;
  onChange: (value: SelectorKindFilterValue) => void;
};

const OPTIONS: Array<{ value: SelectorKindFilterValue; label: string }> = [
  { value: "all", label: "All types" },
  { value: "class", label: "Class" },
  { value: "id", label: "ID" },
  { value: "element", label: "Element" },
  { value: "attribute", label: "Attribute" },
  { value: "universal", label: "Universal" },
  { value: "compound", label: "Compound" },
  { value: "combinator", label: "Combinator" },
  { value: "pseudo", label: "Pseudo" },
  { value: "mixed", label: "Mixed" },
  { value: "other", label: "Other" },
];

export function SelectorKindFilter({
  value,
  onChange,
}: SelectorKindFilterProps) {
  return (
    <div className="dashboard__kind-filter">
      <label className="visually-hidden" htmlFor="selector-kind-filter">
        Filter by selector type
      </label>
      <select
        id="selector-kind-filter"
        value={value}
        onChange={(event) =>
          onChange(event.target.value as SelectorKindFilterValue)
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
