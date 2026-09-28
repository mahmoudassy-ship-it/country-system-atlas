import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { CountrySummary } from "../data/types";

interface SearchBoxProps {
  countries: CountrySummary[];
  onSelect: (iso3: string) => void;
}

export function SearchBox({ countries, onSelect }: SearchBoxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return countries
      .filter(
        (country) =>
          country.name.toLowerCase().includes(normalized) ||
          country.iso3.toLowerCase().startsWith(normalized),
      )
      .slice(0, 7);
  }, [countries, query]);

  const selectCountry = (country: CountrySummary) => {
    setQuery("");
    setOpen(false);
    onSelect(country.iso3);
  };

  return (
    <div className="country-search">
      <Search size={17} aria-hidden="true" />
      <input
        aria-label="Search a country"
        placeholder="Search a country"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter" && matches[0]) selectCountry(matches[0]);
        }}
      />
      {open && query && (
        <div className="search-results" role="listbox" aria-label="Country results">
          {matches.length ? (
            matches.map((country) => (
              <button
                key={country.iso3}
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => selectCountry(country)}
              >
                <span>{country.name}</span>
                <span>{country.iso3}</span>
              </button>
            ))
          ) : (
            <p>No matching country</p>
          )}
        </div>
      )}
    </div>
  );
}
