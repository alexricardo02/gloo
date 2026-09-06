'use client'

import React from 'react'

type Props = { error: Error; reset: () => void }

export default function GlobalError({ error, reset }: Props) {
  // Only surface raw error details in development.
  // In production, error.message may contain internal infrastructure details
  // (e.g. DB constraint names, file paths, stack traces) that must not be
  // exposed to end users.
  const isDev = process.env.NODE_ENV !== 'production';

  return (
    <html>
      <body style={{ fontFamily: 'system-ui', padding: 24 }}>
        <h1>Etwas ist schiefgelaufen</h1>
        <p>
          {isDev
            ? (error?.message ?? 'Unbekannter Fehler')
            : 'Ein interner Fehler ist aufgetreten. Bitte versuche es später erneut.'}
        </p>
        <p>
          <button onClick={reset} style={{ marginRight: 12 }}>
            Erneut versuchen
          </button>
          <a href="/">Zur Startseite</a>
        </p>
      </body>
    </html>
  )
}
