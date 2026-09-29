/* Placeholder sections that the NumNotes website fills in for every app:
 * the name and icon NumWorks' home screen shows, the content bundle, and the
 * flash sector where on-calculator notes are saved. They live in assembly so
 * the compiler can't make assumptions about their contents. */

  .syntax unified

  .section .rodata.eadk_api_level,"a"
  .balign 4
  .global eadk_api_level
eadk_api_level:
  .word 0

  .section .rodata.eadk_app_name,"a"
  .global eadk_app_name
eadk_app_name:
  .asciz "NumNotes"
  .balign 4
  .ascii "NMNT"
  .word 1          /* format version */
  .word 0          /* project id */

  .section .rodata.eadk_app_icon,"a"
  .global eadk_app_icon
eadk_app_icon:
  /* Default icon (LZ4-compressed 55x56 RGB565); replaced for every app. */
  .incbin "icon.nwi"

  .section .rodata.nn_content,"a"
  .balign 4
  .global nn_content
nn_content:
  .word 0

  /* Must stay the last .rodata section: the store sector ends the app. */
  .section .rodata.nn_store,"a"
  .balign 65536
  .global nn_store
nn_store:
  .fill 65536, 1, 0xFF
