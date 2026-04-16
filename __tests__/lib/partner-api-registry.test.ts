// __tests__/lib/partner-api-registry.test.ts — Partner registry loading +
// event-pattern matching.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  eventMatches,
  loadPartnerRegistry,
  subscriptionsForEvent,
  _resetPartnerRegistryCache,
} from '@/lib/partner-api/events/partner-registry'

describe('eventMatches', () => {
  it('exact match', () => {
    expect(eventMatches('engineering.assignment.created', 'engineering.assignment.created')).toBe(true)
  })
  it('single-segment wildcard in the middle does NOT cross a dot', () => {
    expect(eventMatches('engineering.*.created', 'engineering.assignment.created')).toBe(true)
    expect(eventMatches('engineering.*.created', 'engineering.deliverable.created')).toBe(true)
    expect(eventMatches('engineering.*.created', 'engineering.a.b.created')).toBe(false)
  })
  it('trailing .* matches any suffix (cross-dot)', () => {
    expect(eventMatches('engineering.*', 'engineering.assignment.created')).toBe(true)
    expect(eventMatches('engineering.*', 'engineering.a.b.c.deep')).toBe(true)
    expect(eventMatches('engineering.*', 'engineering.')).toBe(false)
    expect(eventMatches('engineering.*', 'engineering')).toBe(false)
    expect(eventMatches('engineering.*', 'other.assignment')).toBe(false)
  })
  it('global wildcard matches anything', () => {
    expect(eventMatches('*', 'literally.anything.at.all')).toBe(true)
  })
  it('miss when segments differ', () => {
    expect(eventMatches('project.stage_changed', 'engineering.assignment.created')).toBe(false)
  })
})

describe('loadPartnerRegistry', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PARTNER_WEBHOOKS', '')
    _resetPartnerRegistryCache()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    _resetPartnerRegistryCache()
  })

  it('returns empty list when env var unset', () => {
    // beforeEach stubbed PARTNER_WEBHOOKS to '' which is falsy; loadPartnerRegistry
    // returns [] for both undefined AND empty string.
    expect(loadPartnerRegistry()).toEqual([])
  })

  it('parses a valid single-entry registry', () => {
    vi.stubEnv('PARTNER_WEBHOOKS', JSON.stringify([
      {
        org_slug: 'rush-engineering',
        url: 'https://rush.example.com/webhook',
        secret: 'wsec_abc',
        event_patterns: ['engineering.*', 'project.stage_changed'],
      },
    ]))
    _resetPartnerRegistryCache()
    const list = loadPartnerRegistry()
    expect(list).toHaveLength(1)
    expect(list[0].org_slug).toBe('rush-engineering')
  })

  it('drops entries with SSRF-rejected URLs', () => {
    vi.stubEnv('PARTNER_WEBHOOKS', JSON.stringify([
      { org_slug: 'bad', url: 'https://127.0.0.1/x', secret: 'w', event_patterns: ['*'] },
      { org_slug: 'good', url: 'https://example.com/x', secret: 'w', event_patterns: ['*'] },
    ]))
    _resetPartnerRegistryCache()
    const list = loadPartnerRegistry()
    expect(list.map((s) => s.org_slug)).toEqual(['good'])
  })

  it('drops entries missing required fields', () => {
    vi.stubEnv('PARTNER_WEBHOOKS', JSON.stringify([
      { org_slug: 'a', url: 'https://example.com/x' /* no secret */ },
      { org_slug: 'b', url: 'https://example.com/x', secret: 's', event_patterns: ['*'] },
    ]))
    _resetPartnerRegistryCache()
    const list = loadPartnerRegistry()
    expect(list.map((s) => s.org_slug)).toEqual(['b'])
  })

  it('returns [] on garbage JSON', () => {
    vi.stubEnv('PARTNER_WEBHOOKS', '{ this is : not json')
    _resetPartnerRegistryCache()
    expect(loadPartnerRegistry()).toEqual([])
  })

})

describe('subscriptionsForEvent', () => {
  const subs = [
    { org_slug: 'rush', url: 'https://a', secret: 'x', event_patterns: ['engineering.*'] },
    { org_slug: 'solicit', url: 'https://b', secret: 'y', event_patterns: ['lead.*'] },
    { org_slug: 'catchall', url: 'https://c', secret: 'z', event_patterns: ['*'] },
  ]

  it('returns only subscriptions whose pattern matches', () => {
    const hits = subscriptionsForEvent(subs, 'engineering.assignment.created')
    expect(hits.map((s) => s.org_slug).sort()).toEqual(['catchall', 'rush'])
  })

  it('returns empty for event no subscription wants', () => {
    const hits = subscriptionsForEvent(
      [
        { org_slug: 'rush', url: 'https://a', secret: 'x', event_patterns: ['engineering.*'] },
      ],
      'lead.created',
    )
    expect(hits).toEqual([])
  })
})

