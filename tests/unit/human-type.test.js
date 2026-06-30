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

  it('humanTypeChars: только keyboard.press, без type/insertText', async () => {
    const keyboard = mockKeyboard();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);

    await humanTypeChars({ keyboard }, 'hi', { typingDelayMin: 1, typingDelayMax: 1 });

    expect(keyboard.press).toHaveBeenCalledWith('h');
    expect(keyboard.press).toHaveBeenCalledWith('i');
    expect(keyboard.type).not.toHaveBeenCalled();
    expect(keyboard.insertText).not.toHaveBeenCalled();
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

    expect(keyboard.press).toHaveBeenNthCalledWith(1, 'b');
    expect(keyboard.press).toHaveBeenCalledWith('Backspace');
    expect(keyboard.press).toHaveBeenNthCalledWith(3, 'a');
    expect(keyboard.type).not.toHaveBeenCalled();
  });

  it('humanTypeChars: кириллица через keyboard.press', async () => {
    const keyboard = mockKeyboard();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);

    await humanTypeChars({ keyboard }, 'при', { typingDelayMin: 1, typingDelayMax: 1 });

    expect(keyboard.press).toHaveBeenCalledWith('п');
    expect(keyboard.press).toHaveBeenCalledWith('р');
    expect(keyboard.press).toHaveBeenCalledWith('и');
  });

  it('humanType: skipFocus — без click/fill, только keyboard.press', async () => {
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
    expect(keyboard.press).toHaveBeenCalledWith('o');
    expect(keyboard.press).toHaveBeenCalledWith('k');
  });
});
