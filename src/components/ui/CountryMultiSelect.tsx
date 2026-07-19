import { useMemo, useState } from 'react'
import { COUNTRIES, countryName } from '../../lib/countries'

const MAX_RESULTS = 8

interface CountryMultiSelectProps {
  id: string
  label: string
  /** ISO 3166-1 alpha-2 codes. */
  value: string[]
  onChange: (codes: string[]) => void
  placeholder?: string
}

export function CountryMultiSelect({ id, label, value, onChange, placeholder }: CountryMultiSelectProps) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return COUNTRIES.filter(
      (country) => !value.includes(country.code) && (q === '' || country.name.toLowerCase().includes(q)),
    ).slice(0, MAX_RESULTS)
  }, [query, value])

  function add(code: string) {
    onChange([...value, code])
    setQuery('')
    setActiveIndex(-1)
    setIsOpen(false)
  }

  function remove(code: string) {
    onChange(value.filter((existing) => existing !== code))
  }

  function closeList() {
    setIsOpen(false)
    setActiveIndex(-1)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!isOpen && results.length > 0) {
        setIsOpen(true)
        return
      }
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      if (isOpen && activeIndex >= 0) {
        event.preventDefault()
        add(results[activeIndex].code)
      }
    } else if (event.key === 'Escape') {
      if (isOpen) {
        event.preventDefault()
        closeList()
      }
    } else if (event.key === 'Backspace' && query === '' && value.length > 0) {
      remove(value[value.length - 1])
    }
  }

  const listboxId = `${id}-listbox`

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((code) => (
            <span
              key={code}
              className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700"
            >
              {countryName(code) ?? code}
              <button
                type="button"
                onClick={() => remove(code)}
                aria-label={`Remove ${countryName(code) ?? code}`}
                className="text-teal-500 hover:text-teal-700"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          id={id}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setIsOpen(true)
            setActiveIndex(-1)
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          onBlur={closeList}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
          autoComplete="off"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
        {isOpen && results.length > 0 && (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-300 bg-white shadow-lg"
          >
            {results.map((country, index) => (
              <li
                key={country.code}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => add(country.code)}
                className={`cursor-pointer px-3 py-2 text-sm text-slate-700 ${
                  index === activeIndex ? 'bg-teal-50' : 'hover:bg-slate-50'
                }`}
              >
                {country.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
