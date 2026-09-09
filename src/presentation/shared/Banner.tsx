import type { PropsWithChildren } from 'react'

type BannerTone = 'success' | 'error' | 'info' | 'warning'

interface BannerProps extends PropsWithChildren {
  tone: BannerTone
}

export function Banner({ tone, children }: BannerProps) {
  return (
    <p className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  )
}
