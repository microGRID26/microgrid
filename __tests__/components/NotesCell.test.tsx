import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NotesCell, type MentionableUser } from '@/components/funding/NotesCell'

const users: MentionableUser[] = [
  { id: 'u_taylor', name: 'Taylor Pratt',  email: 'tpratt@gomicrogridenergy.com' },
  { id: 'u_greg',   name: 'Greg Kelsch',   email: 'greg@gomicrogridenergy.com' },
  { id: 'u_paul',   name: 'Paul Christo',  email: 'paul@energydevelopmentgroup.com' },
]

describe('NotesCell save behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes the full text to onSave (server is authoritative for mention parsing)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<NotesCell value={null} users={users} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button'))
    const textarea = await screen.findByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'hey @tpratt please check this' } })
    fireEvent.blur(textarea)

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith('hey @tpratt please check this')
  })

  it('does not save when text is unchanged', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<NotesCell value="hello world" users={users} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button'))
    const textarea = await screen.findByRole('textbox')
    fireEvent.blur(textarea)

    await new Promise(r => setTimeout(r, 0))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves null when the editor is cleared', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<NotesCell value="something" users={users} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button'))
    const textarea = await screen.findByRole('textbox')
    fireEvent.change(textarea, { target: { value: '' } })
    fireEvent.blur(textarea)

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith(null)
  })

  it('renders previously-saved @handles with green highlighting + full name (resolved mentions)', () => {
    render(<NotesCell value="ping @taylor.pratt" users={users} onSave={vi.fn()} />)
    // Slug parses, but the rendered span shows the full name "@Taylor Pratt".
    const taylor = screen.getByText('@Taylor Pratt')
    expect(taylor.className).toContain('text-green-400')
    expect(taylor.getAttribute('title')).toBe('tpratt@gomicrogridenergy.com')
  })

  it('renders ambiguous @handles with yellow "will not notify" affordance', () => {
    const dupUsers: MentionableUser[] = [
      { id: 'u_greg_a', name: 'Greg Kelsch', email: 'greg@a.com' },
      { id: 'u_greg_b', name: 'Greg Kelsch', email: 'greg@b.com' },
    ]
    render(<NotesCell value="ping @greg.kelsch" users={dupUsers} onSave={vi.fn()} />)
    const span = screen.getByTitle(/Ambiguous/)
    expect(span.className).toContain('text-yellow-400')
    expect(span.getAttribute('title')).toMatch(/will not notify/i)
  })
})
