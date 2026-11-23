import type { ReactNode } from 'react'

const WIDTH = 'w-full max-w-sm sm:max-w-md lg:max-w-xl 2xl:max-w-4xl'

/**
 * Same page frame as upstream's App.tsx: the content centred on the page.
 *
 * - `top` (the basic view's step bar) stays at the top of the page, with the
 *   content centred in the space below it, so it doesn't move between steps.
 * - `corners` (Back and the settings gear) sit in the page's top corners. On
 *   narrow screens the content would reach them, so the page starts lower.
 */
export function Page({
  children,
  footer,
  top,
  corners,
}: {
  children: ReactNode
  footer?: ReactNode
  top?: ReactNode
  corners?: ReactNode
}) {
  return (
    <div
      className={`relative min-h-screen bg-gray-950 flex flex-col items-center p-4 sm:p-6 lg:p-8 ${
        corners ? 'pt-14 sm:pt-14 md:pt-6 lg:pt-8' : ''
      }`}
    >
      {corners}
      {top && <div className={WIDTH}>{top}</div>}
      <div className={`flex-1 w-full flex flex-col items-center justify-center ${top ? 'pt-4 sm:pt-6' : ''}`}>
        <div className={WIDTH}>{children}</div>
        {footer}
      </div>
    </div>
  )
}
