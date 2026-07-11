import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MoveDay',
  description: 'The apartment-hunt companion — compare listings, remember tours, and check your furniture actually fits.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
