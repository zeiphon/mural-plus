import type { ReactNode } from 'react'

/** Longer explanations, collapsed to one "ⓘ label" line until opened. */
export function Help({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group text-xs text-gray-500">
      <summary className="inline-flex cursor-pointer select-none list-none items-center gap-1.5 rounded text-gray-500 transition-colors hover:text-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="flex h-4 w-4 flex-none items-center justify-center rounded-full border border-current text-[10px] font-semibold leading-none"
        >
          i
        </span>
        {label}
        <span aria-hidden className="transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="mt-2 space-y-1.5 border-l-2 border-gray-700 pl-3 leading-relaxed">{children}</div>
    </details>
  )
}
