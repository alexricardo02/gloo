import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'

// Server-render the client component (no DOM library needed). The token
// comes from the URL, so the first render must already show the final view.
let searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParams,
}))
vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  // Render keys as-is so assertions are about which message is chosen.
  useTranslations: () => (key: string) => `[${key}]`,
}))
vi.mock('@/app/actions/auth', () => ({ resetPassword: vi.fn() }))

import ResetPasswordForm from '@/app/[locale]/resetPassword/ResetPasswordForm'

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams()
  })

  it('without a token renders the "tokenMissing" error view on the first render', () => {
    const html = renderToString(<ResetPasswordForm />)

    expect(html).toContain('[errorTitle]')
    expect(html).toContain('[tokenMissing]')
    expect(html).toContain('[requestNewLink]')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('animate-spin') // no "validating" spinner frame
  })

  it('with a token renders the form on the first render, without an error', () => {
    searchParams = new URLSearchParams({ token: 'abc123' })
    const html = renderToString(<ResetPasswordForm />)

    expect(html).toContain('<form')
    expect(html).toContain('[title]')
    expect(html).toContain('[resetButton]')
    expect(html).not.toContain('[errorTitle]')
    expect(html).not.toContain('[tokenMissing]')
    expect(html).not.toContain('animate-spin')
  })
})
