import type { Metadata } from 'next'
import { Try } from '@/components/try'

export const metadata: Metadata = {
  title: 'Try it',
  description: 'Connect your own Solana wallet, get test USDC from the booth, and buy a dataset over libp2p. Every block is checked as it arrives.',
}

export default function TryRoute() {
  return <Try />
}
