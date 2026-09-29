/* Epsilon event codes, as returned by the firmware's event queue. Events are
 * laid out in four pages of 54: plain keys, shift+key, alpha+key and
 * shift+alpha+key. Codes >= 216 are special (timers, USB, ...). */
#ifndef NN_KEYS_H
#define NN_KEYS_H

enum {
  EV_LEFT = 0, EV_UP = 1, EV_DOWN = 2, EV_RIGHT = 3, EV_OK = 4, EV_BACK = 5,
  EV_HOME = 6, EV_ONOFF = 8,
  EV_SHIFT = 12, EV_ALPHA = 13, EV_XNT = 14, EV_VAR = 15, EV_TOOLBOX = 16,
  EV_BACKSPACE = 17, EV_EXP = 18, EV_LN = 19, EV_LOG = 20, EV_IMAGINARY = 21,
  EV_COMMA = 22, EV_POWER = 23, EV_SINE = 24, EV_COSINE = 25, EV_TANGENT = 26,
  EV_PI = 27, EV_SQRT = 28, EV_SQUARE = 29,
  EV_SEVEN = 30, EV_EIGHT = 31, EV_NINE = 32, EV_LPAREN = 33, EV_RPAREN = 34,
  EV_FOUR = 36, EV_FIVE = 37, EV_SIX = 38, EV_MULTIPLY = 39, EV_DIVIDE = 40,
  EV_ONE = 42, EV_TWO = 43, EV_THREE = 44, EV_PLUS = 45, EV_MINUS = 46,
  EV_ZERO = 48, EV_DOT = 49, EV_EE = 50, EV_ANS = 51, EV_EXE = 52,

  EV_SHIFT_PAGE = 54,
  EV_SHIFT_LEFT = 54, EV_SHIFT_UP = 55, EV_SHIFT_DOWN = 56, EV_SHIFT_RIGHT = 57,
  EV_SHIFT_OK = 58, EV_SHIFT_BACK = 59, EV_SHIFT_EXE = 106,
  EV_ALPHA_LOCK = 67, EV_CUT = 68, EV_COPY = 69, EV_PASTE = 70, EV_CLEAR = 71,
  EV_LBRACKET = 72, EV_RBRACKET = 73, EV_LBRACE = 74, EV_RBRACE = 75,
  EV_UNDERSCORE = 76, EV_STO = 77, EV_EQUAL = 81, EV_LOWER = 82,
  EV_GREATER = 83,

  EV_ALPHA_PAGE = 108,
  EV_COLON = 122, EV_SEMICOLON = 123, EV_DQUOTE = 124, EV_PERCENT = 125,
  EV_SPACE = 154, EV_QUESTION = 156, EV_EXCLAMATION = 157,

  EV_UPPER_PAGE = 162,
  EV_SPECIAL = 216,

  EV_NONE = 0xFFFF,
};

/* Unicode codepoint typed by an event, or 0. Function keys insert text like
 * "sin("; see key_text(). */
unsigned key_codepoint(int ev);
/* Multi-character insertions (sin(, ln(, ...), or NULL. */
const char *key_text(int ev);
/* 0-9 for digit keys, -1 otherwise. */
int key_digit(int ev);

#endif
