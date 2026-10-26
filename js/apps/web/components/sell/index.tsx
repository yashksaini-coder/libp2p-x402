'use client'

import dynamic from 'next/dynamic'

// Browser only: the server build would resolve the Node flavour of @libp2p/webrtc (a native addon).
export const SellTab = dynamic(() => import('./SellTab').then((m) => m.SellTab), { ssr: false })
