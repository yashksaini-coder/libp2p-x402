import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LiveDashboard } from '@/components/live/Dashboard'

export const metadata: Metadata = {
  title: 'Live',
  description: 'Stage dashboard: libp2p peers paying each other in Solana USDC for IPFS blocks.',
  robots: { index: false },
}

export default function LivePage() {
  return (
    <Suspense>
      <LiveDashboard />
    </Suspense>
  )
}
