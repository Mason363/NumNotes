#include "keys.h"

#include <stddef.h>

/* Letters live on the alpha and shift+alpha pages, starting at the Exp key.
 * Keys 35, 41 and 47 don't exist, which is why the table has holes. */
static const char k_alpha_chars[] =
    "abcdefghijklmnopq\0rstuv\0wxyz \0?!";
#define ALPHA_FIRST (EV_ALPHA_PAGE + EV_EXP)

int key_digit(int ev) {
  switch (ev) {
    case EV_ZERO: return 0;
    case EV_ONE: return 1;
    case EV_TWO: return 2;
    case EV_THREE: return 3;
    case EV_FOUR: return 4;
    case EV_FIVE: return 5;
    case EV_SIX: return 6;
    case EV_SEVEN: return 7;
    case EV_EIGHT: return 8;
    case EV_NINE: return 9;
    default: return -1;
  }
}

unsigned key_codepoint(int ev) {
  int digit = key_digit(ev);
  if (digit >= 0) return '0' + digit;

  if (ev >= ALPHA_FIRST && ev < ALPHA_FIRST + (int)sizeof(k_alpha_chars) - 1) {
    return (unsigned char)k_alpha_chars[ev - ALPHA_FIRST];
  }
  int upper_first = EV_UPPER_PAGE + EV_EXP;
  if (ev >= upper_first && ev < upper_first + 28) {
    unsigned c = (unsigned char)k_alpha_chars[ev - upper_first];
    return (c >= 'a' && c <= 'z') ? c - 'a' + 'A' : 0;
  }

  switch (ev) {
    case EV_DOT: return '.';
    case EV_PLUS: return '+';
    case EV_MINUS: return '-';
    case EV_MULTIPLY: return 0xD7; /* × */
    case EV_DIVIDE: return '/';
    case EV_LPAREN: return '(';
    case EV_RPAREN: return ')';
    case EV_COMMA: return ',';
    case EV_POWER: return '^';
    case EV_EE: return 'E';
    case EV_IMAGINARY: return 'i';
    case EV_PI: return 0x3C0;      /* π */
    case EV_SQRT: return 0x221A;   /* √ */
    case EV_SQUARE: return 0xB2;   /* ² */
    case EV_XNT: return 'x';
    case EV_LBRACKET: return '[';
    case EV_RBRACKET: return ']';
    case EV_LBRACE: return '{';
    case EV_RBRACE: return '}';
    case EV_UNDERSCORE: return '_';
    case EV_STO: return 0x2192;    /* → */
    case EV_EQUAL: return '=';
    case EV_LOWER: return '<';
    case EV_GREATER: return '>';
    case EV_COLON: return ':';
    case EV_SEMICOLON: return ';';
    case EV_DQUOTE: return '"';
    case EV_PERCENT: return '%';
    default: return 0;
  }
}

const char *key_text(int ev) {
  switch (ev) {
    case EV_EXP: return "e^";
    case EV_LN: return "ln(";
    case EV_LOG: return "log(";
    case EV_SINE: return "sin(";
    case EV_COSINE: return "cos(";
    case EV_TANGENT: return "tan(";
    case EV_SHIFT_PAGE + EV_SINE: return "asin(";
    case EV_SHIFT_PAGE + EV_COSINE: return "acos(";
    case EV_SHIFT_PAGE + EV_TANGENT: return "atan(";
    case EV_ANS: return "ans";
    default: return NULL;
  }
}
