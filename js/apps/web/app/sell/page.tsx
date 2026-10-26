import type { Metadata } from 'next'
import { SellTab } from '@/components/sell'

export const metadata: Metadata = {
  title: 'Sell from a tab',
  description: 'This browser tab runs a Helia node, reserves a slot on a local relay and sells a dataset over libp2p for Solana USDC.',
  robots: { index: false },
}

export default function SellPage() {
  return <SellTab />
}
