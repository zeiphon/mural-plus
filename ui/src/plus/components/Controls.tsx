import type { ReactNode } from 'react'

export function SmallButton(props: { onClick: () => void; disabled?: boolean; primary?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        props.primary
          ? 'bg-cyan-600 enabled:hover:bg-cyan-500 text-white'
          : 'bg-gray-700 enabled:hover:bg-gray-600 text-gray-200'
      }`}
    >
      {props.children}
    </button>
  )
}

export function NumberField(props: {
  label: string
  value: string
  onChange: (v: string) => void
  step?: string
  placeholder?: string
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs text-gray-500">{props.label}</span>
      <input
        type="number"
        step={props.step}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 placeholder:text-gray-600"
      />
    </label>
  )
}
