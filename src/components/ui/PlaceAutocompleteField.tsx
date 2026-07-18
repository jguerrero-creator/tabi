import { useMapsLibrary } from '@vis.gl/react-google-maps'
import { useEffect, useRef, useState } from 'react'

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

const DEBOUNCE_MS = 250

export interface PlaceAutocompleteSelection {
  placeId: string
  placeName: string | null
  text: string
}

interface PlaceAutocompleteFieldProps {
  id: string
  label: string
  value: string
  onTextChange: (text: string) => void
  onPlaceSelect: (place: PlaceAutocompleteSelection) => void
  placeholder?: string
  required?: boolean
  className?: string
}

export function PlaceAutocompleteField({
  id,
  label,
  value,
  onTextChange,
  onPlaceSelect,
  placeholder,
  required,
  className = '',
}: PlaceAutocompleteFieldProps) {
  if (!mapsApiKey) {
    return (
      <div className={`block ${className}`}>
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
          {label}
        </label>
        <input
          id={id}
          value={value}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </div>
    )
  }

  return (
    <PlaceAutocompleteFieldWithPlaces
      id={id}
      label={label}
      value={value}
      onTextChange={onTextChange}
      onPlaceSelect={onPlaceSelect}
      placeholder={placeholder}
      required={required}
      className={className}
    />
  )
}

function PlaceAutocompleteFieldWithPlaces({
  id,
  label,
  value,
  onTextChange,
  onPlaceSelect,
  placeholder,
  required,
  className,
}: PlaceAutocompleteFieldProps) {
  const placesLib = useMapsLibrary('places')
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)
  // The debounced fetchSuggestions() call is scheduled from a setTimeout closure that
  // may have captured `placesLib` while it was still null (library loads async on
  // mount) — reading it via a ref instead of the closed-over variable ensures the
  // callback always sees the current value by the time it actually fires.
  const placesLibRef = useRef(placesLib)
  placesLibRef.current = placesLib
  const lastTypedTextRef = useRef('')

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // If the library was still loading when the debounced fetch fired (fetchSuggestions
  // no-ops without it), retry as soon as it becomes available rather than silently
  // dropping that search — otherwise the user would need to type again to get results.
  useEffect(() => {
    if (placesLib && lastTypedTextRef.current.trim()) {
      fetchSuggestions(lastTypedTextRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the library itself becomes available
  }, [placesLib])

  function closeList() {
    setIsOpen(false)
    setSuggestions([])
    setActiveIndex(-1)
  }

  function handleChange(text: string) {
    onTextChange(text)
    lastTypedTextRef.current = text

    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!text.trim()) {
      closeList()
      return
    }

    debounceRef.current = setTimeout(() => fetchSuggestions(text), DEBOUNCE_MS)
  }

  async function fetchSuggestions(text: string) {
    const currentPlacesLib = placesLibRef.current
    if (!currentPlacesLib) return

    const requestId = ++requestIdRef.current
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new currentPlacesLib.AutocompleteSessionToken()
    }

    try {
      const { suggestions: results } = await currentPlacesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: text,
        sessionToken: sessionTokenRef.current,
      })
      if (requestId !== requestIdRef.current) return
      setSuggestions(results)
      setIsOpen(results.length > 0)
      setActiveIndex(-1)
    } catch {
      if (requestId !== requestIdRef.current) return
      closeList()
    }
  }

  function commit(suggestion: google.maps.places.AutocompleteSuggestion) {
    const prediction = suggestion.placePrediction
    if (!prediction) return

    const text = prediction.text.text
    const placeName = prediction.mainText?.text ?? null

    onTextChange(text)
    onPlaceSelect({ placeId: prediction.placeId, placeName, text })
    closeList()
    sessionTokenRef.current = null
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!isOpen && suggestions.length > 0) {
        setIsOpen(true)
        return
      }
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      if (isOpen && activeIndex >= 0) {
        event.preventDefault()
        commit(suggestions[activeIndex])
      }
    } else if (event.key === 'Escape') {
      if (isOpen) {
        event.preventDefault()
        setIsOpen(false)
      }
    }
  }

  const listboxId = `${id}-listbox`

  return (
    <div className={`relative block ${className}`}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={closeList}
        placeholder={placeholder}
        required={required}
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        autoComplete="off"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
      />
      {isOpen && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-300 bg-white shadow-lg"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.placePrediction?.placeId ?? index}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(suggestion)}
              className={`cursor-pointer px-3 py-2 text-sm text-slate-700 ${
                index === activeIndex ? 'bg-teal-50' : 'hover:bg-slate-50'
              }`}
            >
              {suggestion.placePrediction?.text.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
