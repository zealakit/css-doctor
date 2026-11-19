type ClassSearchProps = {
  value: string;
  onChange: (value: string) => void;
};

export function ClassSearch({ value, onChange }: ClassSearchProps) {
  return (
    <div className="dashboard__search">
      <label className="visually-hidden" htmlFor="class-search">
        Search selectors
      </label>
      <span className="dashboard__search-icon" aria-hidden="true">
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          width="15"
          height="15"
          fill="none"
        >
          <circle
            cx="7"
            cy="7"
            r="4.2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M10.4 10.4 13.5 13.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <input
        id="class-search"
        type="search"
        placeholder="Search selectors, files, status…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}
