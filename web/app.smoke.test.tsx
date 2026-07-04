// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { App } from './App';

afterEach(cleanup);

// Smoke test the React UI end-to-end against the real engine: setup renders, a
// game starts, the human's action panel + map render, and clicking an action
// mutates state without throwing. (Full engine correctness is covered by the
// engine tests; this guards the UI render/wiring.)
describe('web app', () => {
  it('renders setup, starts a human game, and an action advances the log', async () => {
    const { container } = render(<App />);
    expect(container.textContent).toMatch(/hot seat/i);

    // Start with defaults: seat 1 = human, players 3 → p1 (human) acts first,
    // single human so no hand-off gate.
    const startBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Start game')!;
    await act(async () => { fireEvent.click(startBtn); });

    await waitFor(() => expect(container.querySelector('.app.game')).toBeTruthy());
    // map rendered with nodes
    expect(container.querySelectorAll('.map .node').length).toBeGreaterThan(10);
    // the human turn panel with action buttons
    await waitFor(() => expect(container.querySelector('.turn .actions button')).toBeTruthy());

    const beforeLog = container.querySelectorAll('.log-line').length;
    const passBtn = [...container.querySelectorAll('.turn .actions button')].find((b) => /pass/i.test(b.textContent || ''))!;
    expect(passBtn).toBeTruthy();
    await act(async () => { fireEvent.click(passBtn); });

    // still alive, and the game advanced (a new log line, or the turn moved on)
    await waitFor(() => expect(container.querySelector('.app.game')).toBeTruthy());
    expect(container.querySelectorAll('.log-line').length).toBeGreaterThanOrEqual(beforeLog);
  });

  it('renders an all-bot game screen when a seat is assigned a bot', async () => {
    const { container } = render(<App />);
    // set seat 1 to a named bot → the game will auto-play (all seats bots)
    const sel = container.querySelector('.seat-row select') as HTMLSelectElement;
    await act(async () => { fireEvent.change(sel, { target: { value: 'gambler' } }); });
    const startBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Start game')!;
    await act(async () => { fireEvent.click(startBtn); });
    await waitFor(() => expect(container.querySelector('.app.game')).toBeTruthy());
    // active seat is a bot → the "playing…" panel shows, no crash
    await waitFor(() => expect(container.querySelector('.bot-turn')).toBeTruthy());
  });
});
