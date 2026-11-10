import { describe, it, expect, beforeEach } from 'vitest'
import {
  REGISTER_DRAFT_KEY,
  loadRegisterDraft,
  saveRegisterDraft,
  clearRegisterDraft,
} from '@/lib/registerDraft'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  setItem(key: string, value: string) { this.map.set(key, String(value)) }
  removeItem(key: string) { this.map.delete(key) }
}

const stored = (s: MemoryStorage) => {
  const raw = s.getItem(REGISTER_DRAFT_KEY)
  return raw === null ? null : JSON.parse(raw)
}

describe('register draft persistence', () => {
  let storage: MemoryStorage
  beforeEach(() => { storage = new MemoryStorage() })

  it('saves only the non-secret fields, even if a password is passed at runtime', () => {
    const withSecret = {
      name: 'Ann', email: 'a@x.com', dob: '2000-01-01', username: 'ann', agreed: true,
      password: 'Sup3rSecret!', confirmPassword: 'Sup3rSecret!',
    }
    saveRegisterDraft(storage, withSecret)

    expect(stored(storage)).toEqual({
      name: 'Ann', email: 'a@x.com', dob: '2000-01-01', username: 'ann', agreed: true,
    })
    expect(storage.getItem(REGISTER_DRAFT_KEY)).not.toContain('Sup3rSecret')
  })

  it('never returns a password and sanitizes legacy stored data that contains one', () => {
    storage.setItem(REGISTER_DRAFT_KEY, JSON.stringify({
      name: 'Ann', email: 'a@x.com', dob: '', username: 'ann', password: 'Legacy123!', agreed: true,
    }))

    const draft = loadRegisterDraft(storage)

    expect(draft).toEqual({ name: 'Ann', email: 'a@x.com', dob: '', username: 'ann', agreed: true })
    expect(draft).not.toHaveProperty('password')
    expect(stored(storage)).not.toHaveProperty('password')
    expect(storage.getItem(REGISTER_DRAFT_KEY)).not.toContain('Legacy123!')
    expect(stored(storage).username).toBe('ann')
  })

  it('drops fields with unexpected types', () => {
    storage.setItem(REGISTER_DRAFT_KEY, JSON.stringify({ name: 42, username: 'ann', agreed: 'yes' }))
    expect(loadRegisterDraft(storage)).toEqual({ username: 'ann' })
    expect(stored(storage)).toEqual({ username: 'ann' })
  })

  it('removes unparseable or non-object data', () => {
    storage.setItem(REGISTER_DRAFT_KEY, '{not json')
    expect(loadRegisterDraft(storage)).toEqual({})
    expect(storage.getItem(REGISTER_DRAFT_KEY)).toBeNull()

    storage.setItem(REGISTER_DRAFT_KEY, JSON.stringify(['password']))
    expect(loadRegisterDraft(storage)).toEqual({})
    expect(storage.getItem(REGISTER_DRAFT_KEY)).toBeNull()
  })

  it('returns an empty draft when nothing is stored', () => {
    expect(loadRegisterDraft(storage)).toEqual({})
  })

  it('clearRegisterDraft removes the key entirely', () => {
    saveRegisterDraft(storage, { name: 'A', email: '', dob: '', username: '', agreed: false })
    clearRegisterDraft(storage)
    expect(storage.getItem(REGISTER_DRAFT_KEY)).toBeNull()
  })
})
