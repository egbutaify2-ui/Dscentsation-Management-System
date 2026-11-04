// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditActivityPage } from './AuditActivityPage.js';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../../lib/api/client.js', () => ({
  ApiError: class ApiError extends Error {
    readonly status = 403;
    readonly code = 'FORBIDDEN';
  },
  api: {
    get: mocks.get,
  },
}));

const employeeId = '11111111-1111-4111-8111-111111111111';
const recordId = '22222222-2222-4222-8222-222222222222';
const sampleResponse = {
  items: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      actorUserId: employeeId,
      actorDisplayName: 'Jane Employee',
      action: 'product.updated',
      entityType: 'product',
      entityId: recordId,
      occurredAt: '2026-10-31T23:00:00.000Z',
      safeMetadata: {
        password: 'must-never-render',
        sessionPayload: 'must-never-render-session',
        authenticationToken: 'must-never-render-token',
      },
      requestId: 'must-never-render-request-id',
    },
  ],
  actors: [{ id: employeeId, displayName: 'Jane Employee' }],
  page: 1,
  pageSize: 25,
  total: 1,
  totalPages: 1,
};

afterEach(() => cleanup());

describe('AuditActivityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue(sampleResponse);
  });

  it('shows a loading state while the first audit request is pending', () => {
    mocks.get.mockReturnValueOnce(new Promise(() => undefined));
    render(<AuditActivityPage />);
    expect(screen.getByRole('status').textContent).toContain('Loading activity history');
  });

  it('renders actor, action, record details and Lagos-local date and time', async () => {
    render(<AuditActivityPage />);

    expect(await screen.findByText('Jane Employee')).toBeTruthy();
    expect(screen.getByText('Product Updated')).toBeTruthy();
    expect(screen.getByText('Product')).toBeTruthy();
    expect(screen.getByText(recordId)).toBeTruthy();

    const expectedDate = new Intl.DateTimeFormat('en-NG', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Africa/Lagos',
    }).format(new Date('2026-10-31T23:00:00.000Z'));
    expect(screen.getByText(expectedDate)).toBeTruthy();
    expect(screen.queryByText('must-never-render')).toBeNull();
    expect(screen.queryByText('must-never-render-session')).toBeNull();
    expect(screen.queryByText('must-never-render-token')).toBeNull();
    expect(screen.queryByText('must-never-render-request-id')).toBeNull();
  });

  it('applies employee, action, record, UUID and date filters to the agreed query keys', async () => {
    render(<AuditActivityPage />);
    await screen.findByText('Jane Employee');

    fireEvent.change(screen.getByLabelText('Employee'), {
      target: { value: employeeId },
    });
    fireEvent.change(screen.getByLabelText('Action'), {
      target: { value: 'product.updated' },
    });
    fireEvent.change(screen.getByLabelText('Record type'), {
      target: { value: 'product' },
    });
    fireEvent.change(screen.getByLabelText('Record UUID'), {
      target: { value: recordId },
    });
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-11-01' },
    });
    fireEvent.change(screen.getByLabelText('End date'), {
      target: { value: '2026-11-02' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    const path = mocks.get.mock.calls[1]?.[0] as string;
    const params = new URLSearchParams(path.split('?')[1]);
    expect(path.startsWith('/audit-logs?')).toBe(true);
    expect(params.get('actorUserId')).toBe(employeeId);
    expect(params.get('action')).toBe('product.updated');
    expect(params.get('entityType')).toBe('product');
    expect(params.get('entityId')).toBe(recordId);
    expect(params.get('from')).toBe('2026-11-01');
    expect(params.get('to')).toBe('2026-11-02');
    expect(params.get('page')).toBe('1');
    expect(params.get('pageSize')).toBe('25');
  });

  it('resets all filters and reloads the first page', async () => {
    render(<AuditActivityPage />);
    await screen.findByText('Jane Employee');
    fireEvent.change(screen.getByLabelText('Record UUID'), {
      target: { value: recordId },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(3));
    expect(screen.getByLabelText('Record UUID')).toHaveProperty('value', '');
    const path = mocks.get.mock.calls[2]?.[0] as string;
    const params = new URLSearchParams(path.split('?')[1]);
    expect(Array.from(params.keys())).toEqual(['page', 'pageSize']);
    expect(params.get('page')).toBe('1');
  });

  it('moves between server-provided pages', async () => {
    mocks.get.mockImplementation(async (path: string) =>
      path.includes('page=2')
        ? { ...sampleResponse, items: [], page: 2, total: 26, totalPages: 2 }
        : { ...sampleResponse, total: 26, totalPages: 2 },
    );
    render(<AuditActivityPage />);
    await screen.findByText('Jane Employee');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('No activity found');
    expect(mocks.get).toHaveBeenLastCalledWith('/audit-logs?page=2&pageSize=25');
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('shows a useful empty state when there are no matching events', async () => {
    mocks.get.mockResolvedValueOnce({ ...sampleResponse, items: [], total: 0, totalPages: 0 });
    render(<AuditActivityPage />);
    expect(await screen.findByText('No activity found')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
  });

  it('renders system-generated activity with the System actor label', async () => {
    mocks.get.mockResolvedValueOnce({
      ...sampleResponse,
      items: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          actorUserId: null,
          actorDisplayName: 'System',
          action: 'system.maintenance.completed',
          entityType: 'system',
          entityId: null,
          occurredAt: '2026-11-02T12:00:00.000Z',
        },
      ],
      actors: [],
    });
    render(<AuditActivityPage />);
    expect(await screen.findByText('System')).toBeTruthy();
    expect(screen.getByText('System event source')).toBeTruthy();
    expect(screen.getByText('System Maintenance Completed')).toBeTruthy();
  });

  it('shows API errors and retries the failed request', async () => {
    mocks.get.mockRejectedValueOnce(new Error('Audit history is temporarily unavailable.'));
    render(<AuditActivityPage />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Audit history is temporarily unavailable.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Jane Employee')).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });


  it('keeps pagination scoped to the last applied filters', async () => {
    mocks.get.mockImplementation(async (path: string) => ({
      ...sampleResponse,
      page: path.includes('page=2') ? 2 : 1,
      total: 26,
      totalPages: 2,
    }));
    render(<AuditActivityPage />);
    await screen.findByText('Jane Employee');

    fireEvent.change(screen.getByLabelText('Action'), {
      target: { value: 'product.updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByLabelText('Action'), {
      target: { value: 'unsaved.draft.filter' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(3));

    const path = mocks.get.mock.calls[2]?.[0] as string;
    const params = new URLSearchParams(path.split('?')[1]);
    expect(params.get('action')).toBe('product.updated');
    expect(params.get('page')).toBe('2');
  });

  it('rejects a malformed record UUID before sending a request', async () => {
    render(<AuditActivityPage />);
    await screen.findByText('Jane Employee');
    fireEvent.change(screen.getByLabelText('Record UUID'), {
      target: { value: 'not-a-uuid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('rejects an inverted date range before sending a filtered request', async () => {
    render(<AuditActivityPage />);
    await screen.findByText('Jane Employee');
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-11-03' },
    });
    fireEvent.change(screen.getByLabelText('End date'), {
      target: { value: '2026-11-02' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});
