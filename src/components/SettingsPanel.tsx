import { MAP_STYLE_LABELS } from '../lib/mapStyles.ts'
import { FPS, computeTimeline, formatDuration } from '../lib/timeline.ts'
import type { AspectRatio, MapStyleId, VideoSettings } from '../lib/types.ts'

interface SettingsPanelProps {
  settings: VideoSettings
  destinationCount: number
  onChange: (patch: Partial<VideoSettings>) => void
}

const ASPECTS: { id: AspectRatio; label: string; hint: string }[] = [
  { id: '9:16', label: '9:16', hint: 'Reels / Stories · 1080×1920' },
  { id: '1:1', label: '1:1', hint: 'Feed post · 1080×1080' },
  { id: '16:9', label: '16:9', hint: 'YouTube / TV · 1920×1080' },
]

const SWATCHES = ['#f97316', '#22c55e', '#38bdf8', '#e11d48', '#a855f7', '#facc15']

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium text-slate-400">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-500/60'

export function SettingsPanel({ settings, destinationCount, onChange }: SettingsPanelProps) {
  const timeline = computeTimeline(destinationCount, settings.secondsPerDestination)

  return (
    <div className="space-y-4">
      <Field label="Title">
        <input
          className={inputClass}
          data-testid="setting-title"
          value={settings.title}
          maxLength={60}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </Field>

      <Field label="Subtitle">
        <input
          className={inputClass}
          data-testid="setting-subtitle"
          value={settings.subtitle}
          maxLength={80}
          onChange={(e) => onChange({ subtitle: e.target.value })}
        />
      </Field>

      <div className="space-y-1.5">
        <span className="block text-xs font-medium text-slate-400">Aspect ratio</span>
        <div className="grid grid-cols-3 gap-1.5">
          {ASPECTS.map((aspect) => (
            <button
              key={aspect.id}
              type="button"
              title={aspect.hint}
              data-testid={`aspect-${aspect.id}`}
              aria-pressed={settings.aspect === aspect.id}
              onClick={() => onChange({ aspect: aspect.id })}
              className={`rounded-lg border px-2 py-2 text-xs font-semibold transition ${
                settings.aspect === aspect.id
                  ? 'border-sky-500 bg-sky-500/15 text-sky-200'
                  : 'border-white/10 text-slate-400 hover:border-white/25'
              }`}
            >
              {aspect.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="block text-xs font-medium text-slate-400">Arc colour</span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            data-testid="setting-color"
            value={settings.arcColor}
            onChange={(e) => onChange({ arcColor: e.target.value })}
            aria-label="Arc colour"
            className="h-9 w-12 cursor-pointer rounded border border-white/10 bg-slate-950"
          />
          <div className="flex gap-1.5">
            {SWATCHES.map((hex) => (
              <button
                key={hex}
                type="button"
                aria-label={`Use ${hex}`}
                onClick={() => onChange({ arcColor: hex })}
                style={{ background: hex }}
                className={`h-7 w-7 rounded-full border-2 transition ${
                  settings.arcColor.toLowerCase() === hex
                    ? 'border-white'
                    : 'border-transparent hover:border-white/40'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      <Field label="Basemap">
        <select
          className={inputClass}
          data-testid="setting-style"
          value={settings.mapStyle}
          onChange={(e) => onChange({ mapStyle: e.target.value as MapStyleId })}
        >
          {(Object.keys(MAP_STYLE_LABELS) as MapStyleId[]).map((id) => (
            <option key={id} value={id}>
              {MAP_STYLE_LABELS[id]}
            </option>
          ))}
        </select>
      </Field>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium text-slate-400">Seconds per destination</span>
          <span className="font-mono text-xs text-slate-300">
            {settings.secondsPerDestination.toFixed(2)}s
          </span>
        </div>
        <input
          type="range"
          min={0.2}
          max={2}
          step={0.05}
          data-testid="setting-seconds"
          value={settings.secondsPerDestination}
          onChange={(e) => onChange({ secondsPerDestination: Number(e.target.value) })}
          aria-label="Seconds per destination"
          className="w-full"
        />
        <p className="text-[11px] text-slate-500">
          Clip length {formatDuration(timeline.totalFrames)} · {timeline.totalFrames} frames at{' '}
          {FPS}fps
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-white/10 p-2.5">
        <input
          type="checkbox"
          data-testid="setting-zoomout"
          checked={settings.slowZoomOut}
          onChange={(e) => onChange({ slowZoomOut: e.target.checked })}
          className="mt-0.5 accent-sky-500"
        />
        <span className="text-xs">
          <span className="block font-medium text-slate-200">Slow zoom-out</span>
          <span className="block text-slate-500">
            Backs the camera off by 5% across the clip. Off by default — a static camera keeps the
            arcs the only thing moving.
          </span>
        </span>
      </label>

      <Field label="Corner wordmark">
        <input
          className={inputClass}
          data-testid="setting-logo"
          value={settings.logoText}
          maxLength={24}
          placeholder="Leave empty to hide"
          onChange={(e) => onChange({ logoText: e.target.value })}
        />
      </Field>
    </div>
  )
}
