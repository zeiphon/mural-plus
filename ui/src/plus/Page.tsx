import type { ReactNode } from 'react'

/** Same page frame as upstream's App.tsx. */
export function Page({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-sm sm:max-w-md lg:max-w-xl 2xl:max-w-4xl">{children}</div>
      {footer}
    </div>
  )
}
