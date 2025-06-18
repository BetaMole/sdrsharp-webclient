import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/lib/theme-provider'
import { RTLSDRProvider } from '@/lib/RTLSDRContext'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Sdrsharp Web Client',
  description: 'A web-based SDRSharp client for controlling RTL-SDR devices.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider>
          <RTLSDRProvider>
            {children}
          </RTLSDRProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
