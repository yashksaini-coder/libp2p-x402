import { ImageResponse } from 'next/og'

export const alt = 'libp2p x402: agents that get paid without running a server'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OgImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', background: '#000', color: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 80 }}>
        <div style={{ fontSize: 28, color: '#9B9B9B', letterSpacing: 4 }}>LIBP2P X402</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ fontSize: 72, fontWeight: 600, lineHeight: 1.05 }}>Agents that get paid</div>
          <div style={{ fontSize: 72, fontWeight: 600, lineHeight: 1.05, color: '#9B9B9B' }}>without running a server</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 28, color: '#9B9B9B' }}>
          <div style={{ width: 16, height: 16, borderRadius: 8, background: '#14F195' }} />
          Settled on Solana devnet · open spec for x402 v2
        </div>
      </div>
    ),
    size,
  )
}
