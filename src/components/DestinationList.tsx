import { useState } from 'react'
import { reorder } from '../lib/array.ts'
import type { Place } from '../lib/types.ts'

interface DestinationListProps {
  destinations: Place[]
  onChange: (next: Place[]) => void
  /** Drag reorder is not a form control, so a disabled fieldset misses it. */
  disabled?: boolean
}

export function DestinationList({ destinations, onChange, disabled }: DestinationListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const update = (index: number, patch: Partial<Place>) => {
    onChange(destinations.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  }

  const remove = (index: number) => {
    onChange(destinations.filter((_, i) => i !== index))
  }

  const move = (from: number, to: number) => {
    onChange(reorder(destinations, from, to))
  }

  if (destinations.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-xs text-slate-500">
        No destinations yet. Search above to add the towns you deliver to.
      </p>
    )
  }

  return (
    <ul data-testid="destination-list" className="space-y-2">
      {destinations.map((dest, index) => (
        <li
          key={dest.id}
          data-testid="destination-item"
          draggable={!disabled}
          onDragStart={(e) => {
            setDragIndex(index)
            e.dataTransfer.effectAllowed = 'move'
            // Firefox needs data set for a drag to start at all.
            e.dataTransfer.setData('text/plain', String(index))
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            if (overIndex !== index) setOverIndex(index)
          }}
          onDrop={(e) => {
            e.preventDefault()
            const from = dragIndex ?? Number(e.dataTransfer.getData('text/plain'))
            if (Number.isInteger(from)) move(from, index)
            setDragIndex(null)
            setOverIndex(null)
          }}
          onDragEnd={() => {
            setDragIndex(null)
            setOverIndex(null)
          }}
          className={`rounded-lg border bg-slate-950/50 p-2.5 transition ${
            overIndex === index && dragIndex !== index
              ? 'border-sky-500/70'
              : 'border-white/10'
          } ${dragIndex === index ? 'opacity-40' : ''}`}
        >
          <div className="flex items-start gap-2">
            <span
              aria-hidden
              title="Drag to reorder"
              className="mt-1.5 cursor-grab select-none text-slate-600"
            >
              ⠿
            </span>
            <span className="mt-1 w-5 shrink-0 text-center font-mono text-[11px] text-slate-500">
              {index + 1}
            </span>

            <div className="min-w-0 flex-1 space-y-1.5">
              <input
                value={dest.name}
                data-testid="destination-name"
                onChange={(e) => update(index, { name: e.target.value })}
                aria-label={`Name for destination ${index + 1}`}
                className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-slate-100 outline-none hover:border-white/10 focus:border-sky-500/60 focus:bg-slate-950"
              />
              <input
                value={dest.subLabel ?? ''}
                data-testid="destination-sublabel"
                placeholder="Sub-label, e.g. 24 units"
                onChange={(e) => update(index, { subLabel: e.target.value })}
                aria-label={`Sub-label for destination ${index + 1}`}
                className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-slate-400 outline-none placeholder:text-slate-600 hover:border-white/10 focus:border-sky-500/60 focus:bg-slate-950"
              />
              <p className="px-1 font-mono text-[10px] text-slate-600">
                {dest.lat.toFixed(4)}, {dest.lng.toFixed(4)}
              </p>
            </div>

            {/* Touch targets: these were 16px tall, which is unhittable on a
                phone. 32px square is the smallest that works reliably. */}
            <div className="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                aria-label={`Move ${dest.name} up`}
                data-testid="move-up"
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
                className="flex h-8 w-8 items-center justify-center rounded text-xs text-slate-500 transition hover:bg-white/5 hover:text-slate-200 disabled:opacity-25"
              >
                ▲
              </button>
              <button
                type="button"
                aria-label={`Move ${dest.name} down`}
                data-testid="move-down"
                disabled={index === destinations.length - 1}
                onClick={() => move(index, index + 1)}
                className="flex h-8 w-8 items-center justify-center rounded text-xs text-slate-500 transition hover:bg-white/5 hover:text-slate-200 disabled:opacity-25"
              >
                ▼
              </button>
              <button
                type="button"
                aria-label={`Remove ${dest.name}`}
                data-testid="remove-destination"
                onClick={() => remove(index)}
                className="flex h-8 w-8 items-center justify-center rounded text-xs text-slate-600 transition hover:bg-rose-500/10 hover:text-rose-300"
              >
                ✕
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
