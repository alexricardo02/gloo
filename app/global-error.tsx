'use client'

import React from 'react'

type Props = { error: Error }

export default function GlobalError({ error }: Props) {
  return (
    <html>
      <body style={{ fontFamily: 'system-ui', padding: 24 }}>
        <h1>Etwas ist schiefgelaufen</h1>
        <p>{error?.message ?? 'Unbekannter Fehler'}</p>
        <p>
          <a href="/">Zur Startseite</a>
        </p>
      </body>
    </html>
  )
}
