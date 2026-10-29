'use client'

import dynamic from 'next/dynamic'

// Browser only: the buyer runs a Helia node and the wallet standard registry lives on window.
export const Try = dynamic(() => import('./TryPage').then((m) => m.TryPage), { ssr: false })
