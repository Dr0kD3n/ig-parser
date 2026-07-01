import { describe, it, expect, vi, afterEach } from 'vitest';

const { humanType, humanTypeChars } = require('../../backend/lib/utils');

function mockKeyboard() {
  return {
    press: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    insertText: vi.fn().mockResolvedValue(undefined),
  };
}

describe('humanType / humanTypeChars', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('humanTypeChars: символы через keyboard.type, без insertText', async () => {
    const keyboard = mockKeyboard();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);

    await humanTypeChars({ keyboard }, 'hi', { typingDelayMin: 1, typingDelayMax: 1 });

    expect(keyboard.type).toHaveBeenCalledWith('h');
    expect(keyboard.type).toHaveBeenCalledWith('i');
    expect(keyboard.insertText).not.toHaveBeenCalled();
    expect(keyboard.press).not.toHaveBeenCalled();
  });

  it('humanTypeChars: опечатка → Backspace → правильный символ', async () => {
    const keyboard = mockKeyboard();
    let roll = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      roll++;
      if (roll === 1) return 0.01;
      if (roll === 2) return 0.9;
      return 0.99;
    });

    await humanTypeChars({ keyboard }, 'a', { typingDelayMin: 1, typingDelayMax: 1 });

    expect(keyboard.type).toHaveBeenNthCalledWith(1, 'b');
    expect(keyboard.press).toHaveBeenCalledWith('Backspace');
    expect(keyboard.type).toHaveBeenNthCalledWith(2, 'a');
  });

  it('humanTypeChars: кириллица через keyboard.type', async () => {
    const keyboard = mockKeyboard();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);

    await humanTypeChars({ keyboard }, 'при', { typingDelayMin: 1, typingDelayMax: 1 });

    expect(keyboard.type).toHaveBeenCalledWith('п');
    expect(keyboard.type).toHaveBeenCalledWith('р');
    expect(keyboard.type).toHaveBeenCalledWith('и');
  });

  it('humanType: skipFocus — без click/fill, только keyboard.type', async () => {
    const keyboard = mockKeyboard();
    const element = {
      count: vi.fn().mockResolvedValue(1),
      click: vi.fn(),
      fill: vi.fn(),
      focus: vi.fn(),
      evaluate: vi.fn().mockResolvedValue(true),
    };
    const page = {
      keyboard,
      locator: vi.fn().mockReturnValue({ first: () => element }),
    };
    vi.spyOn(Math, 'random').mockReturnValue(0.99);

    await humanType(page, 'input', 'ok', { typingDelayMin: 1, typingDelayMax: 1 }, { skipFocus: true });

    expect(element.click).not.toHaveBeenCalled();
    expect(element.fill).not.toHaveBeenCalled();
    expect(element.focus).not.toHaveBeenCalled();
    expect(keyboard.type).toHaveBeenCalledWith('o');
    expect(keyboard.type).toHaveBeenCalledWith('k');
  });
});
