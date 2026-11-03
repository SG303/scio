import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LANGUAGE_MAX_LENGTH, LANGUAGE_PRESETS } from '@/lib/constants'

const AUTO = '__auto'
const OTHER = '__other'

type LanguageSelectProps = {
  id: string
  /** "" = language of the material */
  value: string
  onChange: (value: string) => void
  hint?: string
}

/** Language of generated questions/cards: a few presets, "Other…" for any language. */
export function LanguageSelect({ id, value, onChange, hint }: LanguageSelectProps) {
  const isPreset = (LANGUAGE_PRESETS as readonly string[]).includes(value)
  const [otherPicked, setOtherPicked] = useState(false)
  const isOther = otherPicked || (value !== '' && !isPreset)
  const selectValue = isOther ? OTHER : value === '' ? AUTO : value

  const handleSelect = (next: string) => {
    setOtherPicked(next === OTHER)
    if (next === OTHER) onChange(isPreset ? '' : value)
    else onChange(next === AUTO ? '' : next)
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Language</Label>
      <Select value={selectValue} onValueChange={handleSelect}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>Same as the material</SelectItem>
          {LANGUAGE_PRESETS.map((language) => (
            <SelectItem key={language} value={language}>
              {language}
            </SelectItem>
          ))}
          <SelectItem value={OTHER}>Other…</SelectItem>
        </SelectContent>
      </Select>
      {isOther && (
        <Input
          aria-label="Other language"
          value={value}
          maxLength={LANGUAGE_MAX_LENGTH}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g., Portuguese"
        />
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
