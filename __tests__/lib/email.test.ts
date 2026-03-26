import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTemplate, getMaxDay } from '@/lib/email-templates'
import { sendEmail } from '@/lib/email'

// ── Template Tests ───────────────────────────────────────────────────────────

describe('email-templates', () => {
  describe('all 30 templates exist and return { subject, html }', () => {
    for (let day = 1; day <= 30; day++) {
      it(`day ${day} returns a valid template`, () => {
        const t = getTemplate(day, 'Test User')
        expect(t).not.toBeNull()
        expect(t).toHaveProperty('subject')
        expect(t).toHaveProperty('html')
      })
    }
  })

  describe('all subjects are non-empty strings', () => {
    for (let day = 1; day <= 30; day++) {
      it(`day ${day} has a non-empty subject`, () => {
        const t = getTemplate(day, 'Test User')!
        expect(typeof t.subject).toBe('string')
        expect(t.subject.trim().length).toBeGreaterThan(0)
      })
    }
  })

  describe('all HTML contains NOVA branding', () => {
    for (let day = 1; day <= 30; day++) {
      it(`day ${day} HTML includes NOVA`, () => {
        const t = getTemplate(day, 'Test User')!
        expect(t.html).toContain('NOVA')
      })
    }
  })

  describe('all HTML contains a CTA link', () => {
    for (let day = 1; day <= 30; day++) {
      it(`day ${day} HTML includes an <a href= link`, () => {
        const t = getTemplate(day, 'Test User')!
        expect(t.html).toMatch(/<a\s+href=/)
      })
    }
  })

  describe('recap emails on days 7, 14, 21', () => {
    it.each([7, 14, 21])('day %i is a recap email', (day) => {
      const t = getTemplate(day, 'Test User')!
      expect(t.subject.toLowerCase()).toContain('recap')
    })
  })

  describe('day 30 is the graduation email', () => {
    it('day 30 subject indicates graduation/completion', () => {
      const t = getTemplate(30, 'Test User')!
      // Day 30 subject: "You're a NOVA Expert — What's Next?"
      expect(t.subject.toLowerCase()).toMatch(/expert|graduat|next|complete/)
    })

    it('day 30 HTML contains congratulatory content', () => {
      const t = getTemplate(30, 'Test User')!
      expect(t.html.toLowerCase()).toMatch(/expert|congratulat|complet/)
    })
  })

  describe('templates outside 1-30 return null', () => {
    it.each([0, -1, 31, 50, 100, -999])('day %i returns null', (day) => {
      const t = getTemplate(day, 'Test User')
      expect(t).toBeNull()
    })
  })

  describe('getMaxDay returns 30', () => {
    it('returns 30', () => {
      expect(getMaxDay()).toBe(30)
    })
  })

  describe('template personalisation', () => {
    it('includes the user name in day 1 HTML', () => {
      const t = getTemplate(1, 'Alice')!
      expect(t.html).toContain('Alice')
    })

    it('falls back to "there" when name is empty', () => {
      const t = getTemplate(1, '')!
      expect(t.html).toContain('there')
    })
  })
})

// ── sendEmail Tests ──────────────────────────────────────────────────────────

describe('sendEmail', () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY
  })

  it('returns true when RESEND_API_KEY is not set (silent skip)', async () => {
    const result = await sendEmail('test@example.com', 'Test', '<p>Hello</p>')
    expect(result).toBe(true)
  })
})
