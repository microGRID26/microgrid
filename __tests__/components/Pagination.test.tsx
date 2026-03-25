import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Pagination } from '@/components/Pagination'

describe('Pagination', () => {
  const defaultProps = {
    currentPage: 2,
    totalCount: 250,
    pageSize: 100,
    hasMore: true,
    onPrevPage: vi.fn(),
    onNextPage: vi.fn(),
  }

  it('renders page indicator', () => {
    render(<Pagination {...defaultProps} />)

    // totalPages = ceil(250/100) = 3
    expect(screen.getByText('2 / 3')).toBeDefined()
  })

  it('prev button is disabled on page 1', () => {
    render(<Pagination {...defaultProps} currentPage={1} />)

    const prevButton = screen.getByLabelText('Previous page')
    expect(prevButton).toBeDisabled()
  })

  it('next button is disabled when hasMore is false', () => {
    render(<Pagination {...defaultProps} hasMore={false} />)

    const nextButton = screen.getByLabelText('Next page')
    expect(nextButton).toBeDisabled()
  })

  it('calls onPrevPage when prev button is clicked', () => {
    const onPrevPage = vi.fn()
    render(<Pagination {...defaultProps} onPrevPage={onPrevPage} />)

    fireEvent.click(screen.getByLabelText('Previous page'))
    expect(onPrevPage).toHaveBeenCalledTimes(1)
  })

  it('calls onNextPage when next button is clicked', () => {
    const onNextPage = vi.fn()
    render(<Pagination {...defaultProps} onNextPage={onNextPage} />)

    fireEvent.click(screen.getByLabelText('Next page'))
    expect(onNextPage).toHaveBeenCalledTimes(1)
  })

  it('shows correct total pages calculation', () => {
    render(<Pagination {...defaultProps} totalCount={50} pageSize={100} currentPage={1} hasMore={false} />)

    // totalPages = max(1, ceil(50/100)) = 1
    expect(screen.getByText('1 / 1')).toBeDefined()
  })

  it('prev button is enabled when not on page 1', () => {
    render(<Pagination {...defaultProps} currentPage={3} />)

    const prevButton = screen.getByLabelText('Previous page')
    expect(prevButton).not.toBeDisabled()
  })

  it('next button is enabled when hasMore is true', () => {
    render(<Pagination {...defaultProps} />)

    const nextButton = screen.getByLabelText('Next page')
    expect(nextButton).not.toBeDisabled()
  })
})
