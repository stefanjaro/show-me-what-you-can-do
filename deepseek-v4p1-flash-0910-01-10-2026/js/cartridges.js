/*
 * cartridges.js — the software library.
 *
 * Every cartridge is VOLTA-16 assembly source. The site assembles them live;
 * the test harness assembles the same text headlessly. Nothing here is
 * precompiled, and nothing depends on anything outside this folder.
 */

import { SONG_ASM } from './song.inc.js';

const BOOT = `
; ═══════════════════════════════════════════════════════════════════════════
;  BOOT — what the machine does when you switch it on.
;
;  * paints its own palette
;  * draws a phosphor sine trace that drifts across the screen
;  * plays a small chime on the sound chip
;  * waits politely for a cartridge
; ═══════════════════════════════════════════════════════════════════════════

.def PHASE      0x8B00
.def SEQ1_PTR   0x8B02
.def SEQ1_FRAME 0x8B03
.def SEQ2_PTR   0x8B04
.def SEQ2_FRAME 0x8B05

    ; ── set the palette ────────────────────────────────────────────────────
    LDI R0, palette
    LDI R1, 0
pal_loop:
    STA PAL_INDEX, R1
    LD R2, [R0]
    STA PAL_R, R2
    LDO R2, [R0+1]
    STA PAL_G, R2
    LDO R2, [R0+2]
    STA PAL_B, R2
    LDI R3, 3
    ADD R0, R3
    INC R1
    CMPI R1, 16
    JB pal_loop

    ; ── sound chip: master up, two voices armed ────────────────────────────
    LDI R0, 14
    STA VOLUME, R0
    LDI R0, 89              ; on, volume 12, 50% duty
    STA CH0_CTRL, R0
    LDI R0, 41              ; on, volume 4, 50% duty
    STA CH1_CTRL, R0

    ; ── sequencer state ────────────────────────────────────────────────────
    LDI R0, tune_top
    STA SEQ1_PTR, R0
    LDI R0, 0
    STA SEQ1_FRAME, R0
    LDI R0, tune_bass
    STA SEQ2_PTR, R0
    STA SEQ2_FRAME, R0

main:
    WAIT

    ; ── advance the little tune ────────────────────────────────────────────
    LDI R0, SEQ1_PTR
    LDI R1, CH0_FREQ
    CALL sequencer
    LDI R0, SEQ2_PTR
    LDI R1, CH1_FREQ
    CALL sequencer

    ; ── repaint ────────────────────────────────────────────────────────────
    LDI R0, 0
    CALL BIOS_CLR

    ; frame
    LDI R0, 4
    LDI R1, 2
    LDI R2, 152
    LDI R3, 1
    CALL BIOS_HLINE
    LDI R0, 4
    LDI R1, 117
    LDI R2, 152
    LDI R3, 1
    CALL BIOS_HLINE

    ; phosphor traces, drawn back to front
    LD R0, [PHASE]
    LDI R1, 11
    LDI R2, 2
    CALL trace
    LD R0, [PHASE]
    LDI R1, 5
    LDI R2, 0
    CALL trace
    LD R0, [PHASE]
    ADDI R0, 4
    LDI R1, 3
    LDI R2, 1
    CALL trace

    ; title
    LDI R4, title
    LDI R5, 32
title_loop:
    LD R0, [R4]
    CMPI R0, 0
    JE title_done
    MOV R1, R5
    LDI R2, 20
    LDI R3, 1
    CALL BIOS_CHAR2
    ADDI R5, 12
    INC R4
    JMP title_loop
title_done:

    LDI R0, subtitle
    LDI R1, 5
    LDI R2, 44
    LDI R3, 9
    CALL BIOS_PRINT
    LDI R0, specs
    LDI R1, 11
    LDI R2, 92
    LDI R3, 11
    CALL BIOS_PRINT
    LDI R0, version
    LDI R1, 5
    LDI R2, 100
    LDI R3, 10
    CALL BIOS_PRINT

    ; blinking invitation
    LD R0, [FRAME]
    LDI R1, 32
    AND R0, R1
    JE no_prompt
    LDI R0, prompt
    LDI R1, 32
    LDI R2, 108
    LDI R3, 2
    CALL BIOS_PRINT
no_prompt:

    ; drift the trace
    LD R0, [PHASE]
    ADDI R0, 1
    STA PHASE, R0
    JMP main

; ── trace: R0 = phase, R1 = colour, R2 = offset ────────────────────────────
; y = 62 + offset + sin(x + phase) / 8  — a quiet oscilloscope line.
trace:
    PUSH R0
    PUSH R1
    PUSH R2
    PUSH R3
    PUSH R4
    PUSH R5
    PUSH R6
    PUSH R7
    MOV R4, R0
    MOV R5, R1
    MOV R6, R2
    LDI R7, 0
trace_loop:
    MOV R0, R7
    ADD R0, R4
    CALL BIOS_SIN
    LDI R1, 4
    SAR R0, R1
    ADD R0, R6
    LDI R1, 68
    ADD R0, R1
    MOV R2, R5
    MOV R1, R0
    MOV R0, R7
    CALL BIOS_PIXEL
    INC R7
    LDI R0, 160
    CMP R7, R0
    JB trace_loop
    POP R7
    POP R6
    POP R5
    POP R4
    POP R3
    POP R2
    POP R1
    POP R0
    RET

; ── sequencer: R0 = state (ptr, next-frame), R1 = channel frequency ────────
; The table is pairs of [period, duration]; a period of zero ends and mutes.
sequencer:
    PUSH R0
    PUSH R1
    PUSH R2
    PUSH R3
    PUSH R4
    PUSH R5
    MOV R5, R0
    MOV R6, R1
    LD R4, [R5]
    LDO R0, [R5+1]
    LD R1, [FRAME]
    CMP R1, R0
    JB seq_done
    LD R0, [R4]
    CMPI R0, 0
    JE seq_end
    ST [R6], R0
    LDO R1, [R4+1]
    LD R0, [FRAME]
    ADD R0, R1
    STO [R5+1], R0
    LDI R0, 2
    ADD R4, R0
    ST [R5], R4
    JMP seq_done
seq_end:
    LDI R0, 1
    ADD R6, R0
    LDI R0, 0
    ST [R6], R0
seq_done:
    POP R5
    POP R4
    POP R3
    POP R2
    POP R1
    POP R0
    RET

; ── data ───────────────────────────────────────────────────────────────────
palette:
    .word  0,  1,  3,   14, 13, 11,   15,  5,  2,   15, 11,  3
    .word  9,  2,  2,    2,  8,  7,    3,  7, 14,    9,  6, 14
    .word 13,  5,  9,    8,  9, 10,    4,  5,  7,    2,  3,  4
    .word  1,  6,  5,    8,  4,  1,   12, 11,  9,   15, 15, 15

title:
    .asciiz "VOLTA-16"
subtitle:
    .asciiz "A COMPUTER THAT NEVER WAS"
specs:
    .asciiz "16-BIT CPU: 12.288 MHZ"
version:
    .asciiz "SYSTEM ROM V1.0 - 1983"
prompt:
    .asciiz "INSERT CARTRIDGE"

; a small theme in C
tune_top:
    .word N_C5, 4, N_E5, 4, N_G5, 4, N_C6, 10, N_G5, 4, N_C6, 14
    .word N_B5, 4, N_G5, 4, N_E5, 4, N_C5, 18
    .word N_E5, 4, N_G5, 4, N_C6, 4, N_E6, 16, N_D6, 6, N_C6, 22
    .word 0, 0
tune_bass:
    .word N_C3, 32, N_A2, 24, N_F2, 24, N_G2, 32, 0, 0
`;

const SNAKE = `
; ═══════════════════════════════════════════════════════════════════════════
;  SNAKE — 20 x 14 board, 8-pixel cells, ring-buffer body, hardware RNG.
;
;  Arrows steer, A restarts. Food pays ten points, and the snake gets
;  faster until it does not. The body is a ring buffer of cell indices
;  that wraps through RAM behind a moving head pointer.
; ═══════════════════════════════════════════════════════════════════════════

.def S_HP    0x8B10
.def S_LEN   0x8B11
.def S_DIR   0x8B12
.def S_FOOD  0x8B13
.def S_SCORE 0x8B14
.def S_ACC   0x8B15
.def S_SPEED 0x8B16
.def S_ALIVE 0x8B17
.def S_SND   0x8B18
.def SNAKE   0x8B20

    ; ── palette ────────────────────────────────────────────────────────────
    LDI R0, pal
    LDI R1, 0
sk_pal:
    STA PAL_INDEX, R1
    LD R2, [R0]
    STA PAL_R, R2
    LDO R2, [R0+1]
    STA PAL_G, R2
    LDO R2, [R0+2]
    STA PAL_B, R2
    LDI R3, 3
    ADD R0, R3
    INC R1
    CMPI R1, 16
    JB sk_pal
    LDI R0, 13
    STA VOLUME, R0

start:
    LDI R0, SNAKE
    LDI R1, 148
    STO [R0+0], R1
    LDI R1, 149
    STO [R0+1], R1
    LDI R1, 150
    STO [R0+2], R1
    LDI R1, 151
    STO [R0+3], R1
    LDI R0, SNAKE+4
    STA S_HP, R0
    LDI R0, 4
    STA S_LEN, R0
    LDI R0, 0
    STA S_DIR, R0
    STA S_ACC, R0
    STA S_SCORE, R0
    STA S_SND, R0
    LDI R0, 10
    STA S_SPEED, R0
    LDI R0, 1
    STA S_ALIVE, R0
    CALL new_food
    CALL draw

; ── main loop ──────────────────────────────────────────────────────────────
main:
    WAIT
    LD R0, [S_SND]
    CMPI R0, 0
    JE main_input
    DEC R0
    STA S_SND, R0
    CMPI R0, 0
    JNE main_input
    LDI R0, 0
    STA CH0_CTRL, R0
main_input:
    LD R0, [INPUT]
    LDI R1, PAD_LEFT
    AND R1, R0
    JE in_right
    LD R2, [S_DIR]
    CMPI R2, 0
    JE in_right
    LDI R2, 2
    STA S_DIR, R2
in_right:
    LDI R1, PAD_RIGHT
    AND R1, R0
    JE in_up
    LD R2, [S_DIR]
    CMPI R2, 2
    JE in_up
    LDI R2, 0
    STA S_DIR, R2
in_up:
    LDI R1, PAD_UP
    AND R1, R0
    JE in_down
    LD R2, [S_DIR]
    CMPI R2, 1
    JE in_down
    LDI R2, 3
    STA S_DIR, R2
in_down:
    LDI R1, PAD_DOWN
    AND R1, R0
    JE main_step
    LD R2, [S_DIR]
    CMPI R2, 3
    JE main_step
    LDI R2, 1
    STA S_DIR, R2
main_step:
    LD R0, [S_ACC]
    INC R0
    STA S_ACC, R0
    LD R1, [S_SPEED]
    CMP R0, R1
    JB main
    LDI R0, 0
    STA S_ACC, R0
    CALL tick
    LD R0, [S_ALIVE]
    CMPI R0, 0
    JE game_over
    CALL draw
    JMP main

; ── one game tick: steer, collide, eat, advance ────────────────────────────
tick:
    PUSH R0
    PUSH R1
    PUSH R2
    PUSH R3
    PUSH R4
    PUSH R5
    PUSH R6
    PUSH R7
    LD R4, [S_HP]
    MOV R5, R4
    DEC R5
    LD R5, [R5]
    LDI R0, 20
    MOV R1, R5
    MOD R1, R0
    MOV R2, R5
    DIV R2, R0
    LD R3, [S_DIR]
    LDI R0, dir_delta
    ADD R3, R0
    LD R3, [R3]
    LD R0, [S_DIR]
    CMPI R0, 0
    JNE tk_d1
    CMPI R1, 19
    JAE die
    JMP tk_move
tk_d1:
    CMPI R0, 1
    JNE tk_d2
    CMPI R2, 13
    JAE die
    JMP tk_move
tk_d2:
    CMPI R0, 2
    JNE tk_up
    CMPI R1, 0
    JE die
    JMP tk_move
tk_up:
    CMPI R2, 0
    JE die
tk_move:
    ADD R5, R3
    LD R0, [S_FOOD]
    CMP R0, R5
    JE tk_eat
    LD R6, [S_LEN]
    LD R4, [S_HP]
    SUB R4, R6
    LDI R0, SNAKE
    CMP R4, R0
    JAE tk_scan_ok
    LDI R0, 512
    ADD R4, R0
tk_scan_ok:
    INC R4
    DEC R6
tk_scan:
    CMPI R6, 0
    JE tk_place
    LD R7, [R4]
    CMP R7, R5
    JE die
    INC R4
    LDI R0, SNAKE+512
    CMP R4, R0
    JB tk_nowrap
    LDI R4, SNAKE
tk_nowrap:
    DEC R6
    JMP tk_scan
tk_place:
    LD R4, [S_HP]
    ST [R4], R5
    INC R4
    LDI R0, SNAKE+512
    CMP R4, R0
    JB tk_place_ok
    LDI R4, SNAKE
tk_place_ok:
    STA S_HP, R4
    JMP tk_done
tk_eat:
    LD R4, [S_HP]
    ST [R4], R5
    INC R4
    LDI R0, SNAKE+512
    CMP R4, R0
    JB tk_eat_ok
    LDI R4, SNAKE
tk_eat_ok:
    STA S_HP, R4
    LD R0, [S_LEN]
    INC R0
    STA S_LEN, R0
    LD R0, [S_SCORE]
    ADDI R0, 10
    STA S_SCORE, R0
    LDI R1, 30
    DIV R0, R1
    LDI R1, 10
    SUB R1, R0
    CMPI R1, 5
    JAE speed_ok
    LDI R1, 5
speed_ok:
    STA S_SPEED, R1
    LDI R0, N_E6
    STA CH0_FREQ, R0
    LDI R0, 89
    STA CH0_CTRL, R0
    LDI R0, 4
    STA S_SND, R0
    CALL new_food
    JMP tk_done
die:
    LDI R0, 0
    STA S_ALIVE, R0
tk_done:
    POP R7
    POP R6
    POP R5
    POP R4
    POP R3
    POP R2
    POP R1
    POP R0
    RET

; ── find an empty cell for dinner ──────────────────────────────────────────
new_food:
    PUSH R0
    PUSH R1
    PUSH R2
    PUSH R3
    PUSH R4
    LD R4, [S_LEN]
nf_retry:
    LD R0, [RNG]
    LDI R1, 280
    MOD R0, R1
    LDI R1, SNAKE
    MOV R3, R4
nf_scan:
    CMPI R3, 0
    JE nf_ok
    LD R2, [R1]
    CMP R2, R0
    JE nf_retry
    INC R1
    DEC R3
    JMP nf_scan
nf_ok:
    STA S_FOOD, R0
    POP R4
    POP R3
    POP R2
    POP R1
    POP R0
    RET

; ── repaint ────────────────────────────────────────────────────────────────
draw:
    PUSH R0
    PUSH R1
    PUSH R2
    PUSH R3
    PUSH R4
    PUSH R5
    PUSH R6
    PUSH R7
    LDI R0, 0
    CALL BIOS_CLR
    LDI R0, txt_score
    LDI R1, 2
    LDI R2, 0
    LDI R3, 3
    CALL BIOS_PRINT
    LD R0, [S_SCORE]
    LDI R1, 50
    LDI R2, 0
    LDI R3, 3
    CALL BIOS_NUM
    LDI R0, 0
    LDI R1, 7
    LDI R2, 160
    LDI R3, 10
    CALL BIOS_HLINE
    LD R0, [S_FOOD]
    CALL cell_xy
    MOV R0, R1
    ADDI R0, 1
    MOV R1, R2
    ADDI R1, 1
    LDI R2, 6
    LDI R3, 6
    LDI R4, 2
    CALL BIOS_RECT
    LD R6, [S_LEN]
    LD R5, [S_HP]
    MOV R4, R5
    SUB R4, R6
    LDI R0, SNAKE
    CMP R4, R0
    JAE seg_tail_ok
    LDI R0, 512
    ADD R4, R0
seg_tail_ok:
    MOV R5, R4
seg_loop:
    LD R7, [R5]
    MOV R0, R7
    CALL cell_xy
    MOV R0, R1
    ADDI R0, 1
    MOV R1, R2
    ADDI R1, 1
    LDI R2, 6
    LDI R3, 6
    LDI R4, 5
    CALL BIOS_RECT
    INC R5
    LDI R0, SNAKE+512
    CMP R5, R0
    JB seg_nowrap
    LDI R5, SNAKE
seg_nowrap:
    DEC R6
    CMPI R6, 0
    JNE seg_loop
    LD R5, [S_HP]
    DEC R5
    LD R0, [R5]
    CALL cell_xy
    MOV R0, R1
    ADDI R0, 2
    MOV R1, R2
    ADDI R1, 2
    LDI R2, 4
    LDI R3, 4
    LDI R4, 4
    CALL BIOS_RECT
    POP R7
    POP R6
    POP R5
    POP R4
    POP R3
    POP R2
    POP R1
    POP R0
    RET

; ── cell index -> pixel corner: R0 = cell, out R1 = x*8, R2 = y*8 + 8 ──────
cell_xy:
    PUSH R0
    PUSH R3
    LDI R3, 20
    MOV R1, R0
    MOD R1, R3
    DIV R0, R3
    MOV R2, R0
    SHLI R1, 3
    SHLI R2, 3
    ADDI R2, 8
    POP R3
    POP R0
    RET

; ── game over ──────────────────────────────────────────────────────────────
game_over:
    LDI R0, 0
    CALL BIOS_CLR
    LDI R4, txt_over
    LDI R5, 26
go_text:
    LD R0, [R4]
    CMPI R0, 0
    JE go_score
    MOV R1, R5
    LDI R2, 26
    LDI R3, 2
    CALL BIOS_CHAR2
    ADDI R5, 12
    INC R4
    JMP go_text
go_score:
    LDI R0, txt_final
    LDI R1, 32
    LDI R2, 60
    LDI R3, 1
    CALL BIOS_PRINT
    LD R0, [S_SCORE]
    LDI R1, 74
    LDI R2, 60
    LDI R3, 3
    CALL BIOS_NUM
    LDI R0, txt_again
    LDI R1, 16
    LDI R2, 84
    LDI R3, 6
    CALL BIOS_PRINT
    LDI R0, N_A2
    STA CH0_FREQ, R0
    LDI R0, 89
    STA CH0_CTRL, R0
wait_restart:
    LD R0, [INPUT]
    LDI R1, PAD_A
    AND R0, R1
    JE wait_restart
    LDI R0, 0
    STA CH0_CTRL, R0
    JMP start

; ── data ───────────────────────────────────────────────────────────────────
dir_delta:
    .word 1, 20, -1, -20

pal:
    .word  0,  2,  1,    1,  3,  1,   15,  3,  3,   15, 14,  4
    .word  3, 15,  4,    5,  9,  5,   12, 12, 12,    6,  7,  6
    .word  2,  5,  2,    8,  6,  2,    2,  2,  3,    4,  4,  5
    .word  9, 10,  6,   12, 12, 10,    4,  4,  4,    1,  1,  1

txt_score:
    .asciiz "SCORE"
txt_over:
    .asciiz "GAME OVER"
txt_final:
    .asciiz "FINAL"
txt_again:
    .asciiz "PRESS A TO PLAY AGAIN"
`;

const FIRE = `
; ═══════════════════════════════════════════════════════════════════════════
;  FIRE — a heat field propagating upward through RAM, one third per row.
;
;  An 80 x 60 field at half resolution. Every frame the bottom row is
;  re-seeded from the random generator, each cell becomes the average of the
;  three cells below it (times 11/32, which is close enough to a third),
;  and the whole field is blown up 2x into the frame buffer through a
;  16-step ember palette.
; ═══════════════════════════════════════════════════════════════════════════

.def FIRE 0x8C00
.def FW   80
.def FH   60

    LDI R0, pal
    LDI R1, 0
fire_pal:
    STA PAL_INDEX, R1
    LD R2, [R0]
    STA PAL_R, R2
    LDO R2, [R0+1]
    STA PAL_G, R2
    LDO R2, [R0+2]
    STA PAL_B, R2
    LDI R3, 3
    ADD R0, R3
    INC R1
    CMPI R1, 16
    JB fire_pal

fire_frame:
    ; ── re-seed the bottom row ─────────────────────────────────────────────
    LDI R6, FIRE+59*FW
    LDI R7, FW
seed_loop:
    LD R0, [RNG]
    LDI R1, 255
    AND R0, R1
    ST [R6], R0
    INC R6
    DEC R7
    JNE seed_loop

    ; ── propagate upward ───────────────────────────────────────────────────
    LDI R6, FIRE+59*FW
    LDI R5, FIRE+58*FW
    LDI R4, 59
row_loop:
    LDI R7, 78
    MOV R0, R5
    ADDI R0, 1
    MOV R1, R6
    ADDI R1, 1
cell_loop:
    LDO R2, [R1-1]
    LD R3, [R1]
    ADD R2, R3
    LDO R3, [R1+1]
    ADD R2, R3
    LDI R3, 21
    MUL R2, R3
    SHRI R2, 6
cell_store:
    ST [R0], R2
    INC R0
    INC R1
    DEC R7
    JNE cell_loop
    LDO R2, [R5+1]
    ST [R5], R2
    LDO R2, [R5+78]
    STO [R5+79], R2
    LDI R2, FW
    SUB R5, R2
    SUB R6, R2
    DEC R4
    JNE row_loop

    ; ── blow it up into the frame buffer ───────────────────────────────────
    LDI R4, 0
render_row:
    MOV R5, R4
    LDI R2, FW
    MUL R5, R2
    LDI R2, FIRE
    ADD R5, R2
    MOV R6, R4
    LDI R2, 320
    MUL R6, R2
    LDI R2, VRAM
    ADD R6, R2
    LDI R7, FW
render_cell:
    LD R2, [R5]
    SHRI R2, 4
    ST [R6], R2
    STO [R6+1], R2
    STO [R6+160], R2
    STO [R6+161], R2
    INC R6
    INC R6
    INC R5
    DEC R7
    JNE render_cell
    INC R4
    LDI R2, FH
    CMP R4, R2
    JB render_row

    WAIT
    JMP fire_frame

pal:
    .word  0,  0,  0,    3,  0,  0,    7,  0,  0,   11,  0,  0
    .word 15,  1,  0,   15,  3,  0,   15,  5,  0,   15,  8,  0
    .word 15, 11,  0,   15, 13,  0,   15, 14,  1,   15, 15,  4
    .word 15, 15,  8,   15, 15, 12,   15, 15, 15,   15, 12,  4
`;

const LIFE = `
; ═══════════════════════════════════════════════════════════════════════════
;  LIFE — Conway's game, 53 x 40, wrapped at the edges, double buffered.
;
;  Two 55 x 42 fields with a one-cell padding ring so the neighbour count
;  needs no edge tests: the padding is refreshed from the opposite edge
;  after every generation. A generation plus a full 3x upscale repaint
;  costs about half of one frame's cycle budget, so it ticks ten times a
;  second. A reseeds the soup; it reseeds itself if the soup dies out.
; ═══════════════════════════════════════════════════════════════════════════

.def SRC     0x8B10
.def DST     0x8B11
.def GEN     0x8B12
.def POP     0x8B13
.def ACC     0x8B14
.def LIFE_A  0x8C00
.def LIFE_B  0x9600
.def STRIDE  55
.def WIDTH   53
.def HEIGHT  40

    LDI R0, 0
    CALL BIOS_CLR
    LDI R0, 12
    STA VOLUME, R0
    LDI R0, LIFE_A
    STA SRC, R0
    LDI R0, LIFE_B
    STA DST, R0
    LDI R0, 0
    STA GEN, R0
    STA ACC, R0
    CALL randomize

life_main:
    WAIT
    LD R0, [INPUT]
    LDI R1, PAD_A
    AND R1, R0
    JE life_no_key
    CALL randomize
life_no_key:
    LD R0, [ACC]
    INC R0
    STA ACC, R0
    CMPI R0, 6
    JB life_main
    LDI R0, 0
    STA ACC, R0
    CALL generate
    LD R0, [POP]
    CMPI R0, 0
    JNE life_render
    CALL randomize
life_render:
    CALL render
    JMP life_main

; ── seed the soup (about one cell in eight) ────────────────────────────────
randomize:
    PUSH R0
    PUSH R1
    PUSH R2
    PUSH R3
    PUSH R4
    PUSH R5
    PUSH R6
    PUSH R7
    LDI R0, 0
    STA GEN, R0
    LD R6, [SRC]
    LDI R0, STRIDE
    ADD R6, R0
    INC R6
    LDI R5, HEIGHT
rand_row:
    LDI R7, WIDTH
rand_cell:
    LD R0, [RNG]
    LDI R1, 7
    AND R0, R1
    LDI R1, 0
    CMP R0, R1
    JNE rand_zero
    LDI R0, 1
    JMP rand_store
rand_zero:
    LDI R0, 0
rand_store:
    ST [R6], R0
    INC R6
    DEC R7
    JNE rand_cell
    ADDI R6, 2
    DEC R5
    JNE rand_row
    CALL copy_borders
    POP R7
    POP R6
    POP R5
    POP R4
    POP R3
    POP R2
    POP R1
    POP R0
    RET

; ── wrap the padding ring from the far edge ────────────────────────────────
copy_borders:
    PUSH R0
    PUSH R1
    PUSH R2
    PUSH R3
    PUSH R4
    PUSH R5
    LD R6, [SRC]
    LDI R4, STRIDE
    MOV R0, R6
    MOV R1, R6
    ADD R1, R4
    LDI R5, STRIDE
cb_top:
    LD R2, [R1]
    ST [R0], R2
    INC R0
    INC R1
    DEC R5
    JNE cb_top
    LDI R0, STRIDE*41
    ADD R0, R6
    LDI R1, STRIDE*40
    ADD R1, R6
    LDI R5, STRIDE
cb_bottom:
    LD R2, [R1]
    ST [R0], R2
    INC R0
    INC R1
    DEC R5
    JNE cb_bottom
    LDI R4, STRIDE
    LDI R5, HEIGHT
cb_side:
    MOV R0, R6
    ADD R0, R4
    LDO R2, [R0+1]
    ST [R0], R2
    LDO R1, [R0+53]
    STO [R0+54], R1
    LDI R2, STRIDE
    ADD R4, R2
    DEC R5
    JNE cb_side
    POP R5
    POP R4
    POP R3
    POP R2
    POP R1
    POP R0
    RET

; ── one generation ─────────────────────────────────────────────────────────
generate:
    PUSH R0
    PUSH R1
    PUSH R2
    PUSH R3
    PUSH R4
    PUSH R5
    PUSH R6
    PUSH R7
    LDI R0, 0
    STA POP, R0
    LD R6, [SRC]
    LD R7, [DST]
    LDI R4, STRIDE
    MOV R0, R6
    ADDI R0, 1
    MOV R1, R0
    ADD R1, R4
    MOV R2, R1
    ADD R2, R4
    MOV R3, R7
    ADDI R3, 1
    LDI R4, HEIGHT
gen_row:
    LDI R5, WIDTH
gen_cell:
    LDO R6, [R0-1]
    LDO R7, [R0]
    ADD R6, R7
    LDO R7, [R0+1]
    ADD R6, R7
    LDO R7, [R1-1]
    ADD R6, R7
    LDO R7, [R1+1]
    ADD R6, R7
    LDO R7, [R2-1]
    ADD R6, R7
    LDO R7, [R2]
    ADD R6, R7
    LDO R7, [R2+1]
    ADD R6, R7
    LD R7, [R1]
    CMPI R7, 0
    JE gen_dead
    CMPI R6, 2
    JE gen_born
    CMPI R6, 3
    JE gen_born
    LDI R7, 0
    JMP gen_store
gen_dead:
    CMPI R6, 3
    JNE gen_zero
gen_born:
    LDI R7, 1
    JMP gen_store
gen_zero:
    LDI R7, 0
gen_store:
    ST [R3], R7
    CMPI R7, 0
    JE gen_nopop
    LD R6, [POP]
    INC R6
    STA POP, R6
gen_nopop:
    INC R0
    INC R1
    INC R2
    INC R3
    DEC R5
    JNE gen_cell
    ADDI R0, 2
    ADDI R1, 2
    ADDI R2, 2
    ADDI R3, 2
    DEC R4
    JNE gen_row
    LD R6, [SRC]
    LD R7, [DST]
    ST [SRC], R7
    ST [DST], R6
    LD R6, [GEN]
    INC R6
    STA GEN, R6
    CALL copy_borders
    POP R7
    POP R6
    POP R5
    POP R4
    POP R3
    POP R2
    POP R1
    POP R0
    RET

; ── repaint at 3x, plus a quiet overlay ────────────────────────────────────
render:
    PUSH R0
    PUSH R1
    PUSH R2
    PUSH R3
    PUSH R4
    PUSH R5
    PUSH R6
    PUSH R7
    LD R6, [SRC]
    LDI R4, 1
render_row:
    MOV R5, R4
    LDI R0, STRIDE
    MUL R5, R0
    ADD R5, R6
    INC R5
    MOV R7, R4
    DEC R7
    LDI R0, 480
    MUL R7, R0
    LDI R0, VRAM
    ADD R7, R0
    LDI R3, WIDTH
render_cell:
    LD R2, [R5]
    ST [R7], R2
    STO [R7+1], R2
    STO [R7+2], R2
    STO [R7+160], R2
    STO [R7+161], R2
    STO [R7+162], R2
    STO [R7+320], R2
    STO [R7+321], R2
    STO [R7+322], R2
    ADDI R7, 3
    INC R5
    DEC R3
    JNE render_cell
    INC R4
    LDI R0, HEIGHT+1
    CMP R4, R0
    JB render_row
    LDI R0, txt_life
    LDI R1, 2
    LDI R2, 1
    LDI R3, 10
    CALL BIOS_PRINT
    LDI R0, txt_gen
    LDI R1, 108
    LDI R2, 1
    LDI R3, 10
    CALL BIOS_PRINT
    LD R0, [GEN]
    LDI R1, 128
    LDI R2, 1
    LDI R3, 10
    CALL BIOS_NUM
    POP R7
    POP R6
    POP R5
    POP R4
    POP R3
    POP R2
    POP R1
    POP R0
    RET

txt_life:
    .asciiz "LIFE"
txt_gen:
    .asciiz "GEN"
`;

const CHIPTUNE = `
; ═══════════════════════════════════════════════════════════════════════════
;  CHIPTUNE — a 64-row tracker in three channels, written for the sound chip.
;
;  The score lives at the bottom of the ROM as note periods. Every sixth
;  frame the player advances a row, loads new periods into the pulse and
;  noise channels and decays the meters. The picture is a level meter per
;  channel, a pattern position bar, and sixteen bars of pure decoration
;  dancing to the sine table.
; ═══════════════════════════════════════════════════════════════════════════

.def ROW    0x8B20
.def RACC   0x8B21
.def DRUM   0x8B22
.def LV     0x8B23
.def BV     0x8B24
.def DV     0x8B25
.def PHASE  0x8B26
.def ROWS   64

.def D_KICK  800
.def D_SNARE 120
.def D_HAT    30

    ; ── palette: neon on near-black ────────────────────────────────────────
    LDI R0, pal
    LDI R1, 0
ct_pal:
    STA PAL_INDEX, R1
    LD R2, [R0]
    STA PAL_R, R2
    LDO R2, [R0+1]
    STA PAL_G, R2
    LDO R2, [R0+2]
    STA PAL_B, R2
    LDI R3, 3
    ADD R0, R3
    INC R1
    CMPI R1, 16
    JB ct_pal

    LDI R0, 15
    STA VOLUME, R0
    LDI R0, 0
    STA ROW, R0
    STA RACC, R0
    STA DRUM, R0
    STA LV, R0
    STA BV, R0
    STA DV, R0
    STA PHASE, R0
    CALL play_row

ct_main:
    WAIT
    ; meter decay
    CALL decay_meters
    ; drum envelope
    LD R0, [DRUM]
    CMPI R0, 0
    JE ct_advance
    DEC R0
    STA DRUM, R0
    CMPI R0, 0
    JNE ct_advance
    LDI R0, 0
    STA CH2_CTRL, R0
ct_advance:
    LD R0, [RACC]
    INC R0
    STA RACC, R0
    CMPI R0, 6
    JB ct_draw
    LDI R0, 0
    STA RACC, R0
    LD R0, [ROW]
    INC R0
    LDI R1, ROWS
    CMP R0, R1
    JB ct_row_ok
    LDI R0, 0
ct_row_ok:
    STA ROW, R0
    CALL play_row
ct_draw:
    CALL draw
    LD R0, [PHASE]
    ADDI R0, 2
    STA PHASE, R0
    JMP ct_main

; ── advance the score ──────────────────────────────────────────────────────
play_row:
    PUSH R0
    PUSH R1
    PUSH R2
    PUSH R3
    PUSH R4
    PUSH R5
    LD R4, [ROW]
    LDI R0, song_lead
    ADD R0, R4
    LD R5, [R0]
    CMPI R5, 0
    JE pr_bass               ; zero means hold the previous note
    STA CH0_FREQ, R5
    LDI R5, 89
    STA CH0_CTRL, R5
    LDI R5, 40
    STA LV, R5
pr_bass:
    LDI R0, song_bass
    ADD R0, R4
    LD R5, [R0]
    CMPI R5, 0
    JE pr_drum               ; zero means hold
    STA CH1_FREQ, R5
    LDI R5, 49
    STA CH1_CTRL, R5
    LDI R5, 34
    STA BV, R5
pr_drum:
    LDI R0, song_drum
    ADD R0, R4
    LD R5, [R0]
    CMPI R5, 0
    JE pr_done
    STA CH2_FREQ, R5
    LDI R5, 89
    STA CH2_CTRL, R5
    LDI R5, 3
    STA DRUM, R5
    LDI R5, 38
    STA DV, R5
pr_done:
    POP R5
    POP R4
    POP R3
    POP R2
    POP R1
    POP R0
    RET

; ── meters fall, never below zero ──────────────────────────────────────────
decay_meters:
    PUSH R0
    LD R0, [LV]
    CMPI R0, 0
    JE dm_b
    DEC R0
    STA LV, R0
dm_b:
    LD R0, [BV]
    CMPI R0, 0
    JE dm_d
    DEC R0
    STA BV, R0
dm_d:
    LD R0, [DV]
    CMPI R0, 0
    JE dm_done
    DEC R0
    STA DV, R0
dm_done:
    POP R0
    RET

; ── the picture ────────────────────────────────────────────────────────────
draw:
    PUSH R0
    PUSH R1
    PUSH R2
    PUSH R3
    PUSH R4
    PUSH R5
    PUSH R6
    PUSH R7
    LDI R0, 0
    CALL BIOS_CLR
    LDI R4, txt_title
    LDI R5, 32
dr_title:
    LD R0, [R4]
    CMPI R0, 0
    JE dr_sub
    MOV R1, R5
    LDI R2, 8
    LDI R3, 6
    CALL BIOS_CHAR2
    ADDI R5, 12
    INC R4
    JMP dr_title
dr_sub:
    LDI R0, txt_sub
    LDI R1, 20
    LDI R2, 30
    LDI R3, 10
    CALL BIOS_PRINT

    LDI R0, txt_ch1
    LDI R1, 6
    LDI R2, 46
    LDI R3, 6
    CALL BIOS_PRINT
    LDI R0, txt_ch2
    LDI R1, 6
    LDI R2, 58
    LDI R3, 5
    CALL BIOS_PRINT
    LDI R0, txt_noi
    LDI R1, 6
    LDI R2, 70
    LDI R3, 8
    CALL BIOS_PRINT

    ; meter tracks
    LDI R0, 40
    LDI R1, 46
    LDI R2, 88
    LDI R3, 4
    LDI R4, 11
    CALL BIOS_RECT
    LDI R0, 40
    LDI R1, 58
    LDI R2, 88
    LDI R3, 4
    LDI R4, 11
    CALL BIOS_RECT
    LDI R0, 40
    LDI R1, 70
    LDI R2, 88
    LDI R3, 4
    LDI R4, 11
    CALL BIOS_RECT

    LD R2, [LV]
    SHLI R2, 1
    LDI R0, 40
    LDI R1, 46
    LDI R3, 4
    LDI R4, 6
    CALL BIOS_RECT
    LD R2, [BV]
    SHLI R2, 1
    LDI R0, 40
    LDI R1, 58
    LDI R3, 4
    LDI R4, 5
    CALL BIOS_RECT
    LD R2, [DV]
    SHLI R2, 1
    LDI R0, 40
    LDI R1, 70
    LDI R3, 4
    LDI R4, 8
    CALL BIOS_RECT

    ; pattern position
    LDI R0, 16
    LDI R1, 92
    LDI R2, 128
    LDI R3, 4
    LDI R4, 11
    CALL BIOS_RECT
    LD R2, [ROW]
    SHLI R2, 1
    LDI R0, 16
    LDI R1, 92
    LDI R3, 4
    LDI R4, 2
    CALL BIOS_RECT
    LDI R0, txt_pat
    LDI R1, 58
    LDI R2, 100
    LDI R3, 10
    CALL BIOS_PRINT
    LD R0, [ROW]
    LDI R1, 104
    LDI R2, 100
    LDI R3, 2
    CALL BIOS_NUM

    ; sixteen bars of decoration, dancing to the sine table
    LDI R6, 0
dr_bars:
    MOV R0, R6
    LDI R7, 15
    MUL R0, R7
    LD R7, [PHASE]
    ADD R0, R7
    CALL BIOS_SIN
    CMPI R0, 0
    JGE dr_abs
    NEG R0
dr_abs:
    SHRI R0, 5
    ADDI R0, 3            ; 3..11 pixels tall
    MOV R5, R0
    MOV R4, R6
    LDI R7, 3
    AND R4, R7
    LDI R7, 6
    ADD R4, R7            ; colour 6..9
    MOV R0, R6
    LDI R7, 9
    MUL R0, R7
    ADDI R0, 4            ; x
    LDI R1, 116
    SUB R1, R5            ; y = bottom - height
    LDI R2, 7
    MOV R3, R5
    CALL BIOS_RECT
    INC R6
    CMPI R6, 16
    JB dr_bars
dr_bars_done:
    POP R7
    POP R6
    POP R5
    POP R4
    POP R3
    POP R2
    POP R1
    POP R0
    RET

pal:
    .word  1,  1,  3,   10, 10, 12,   15,  5, 10,    2, 12,  6
    .word  9, 14,  4,   15,  3,  9,    3,  6, 15,    8,  3, 14
    .word 15, 10,  2,   12, 12, 12,    3,  4,  5,    4,  4,  4
    .word  1,  6,  5,    9,  2,  2,    5,  6,  2,   15, 15, 15

txt_title:
    .asciiz "CHIPTUNE"
txt_sub:
    .asciiz "THE SOUND CHIP SINGS"
txt_ch1:
    .asciiz "CH1"
txt_ch2:
    .asciiz "CH2"
txt_noi:
    .asciiz "NOI"
txt_pat:
    .asciiz "PATTERN"

${SONG_ASM}
`;

const RIPPLE = `
; ═══════════════════════════════════════════════════════════════════════════
;  RIPPLE — concentric arithmetic, for the sheer pleasure of it.
;
;  A distance field is precomputed once: dx² for each half-resolution column
;  and dy² for each row, scaled down. Each frame every cell becomes
;  (dx² + dy² + warp(row) - phase) >> 4, so rings travel outward; the warp
;  makes them wobble like water. Meanwhile all sixteen palette entries are
;  recomputed every frame from the sine table on three phase-shifted angles,
;  which makes the colours crawl around the wheel.
; ═══════════════════════════════════════════════════════════════════════════

.def PHASE 0x8B00
.def DX2   0x8C00
.def DY2   0x8D00

    LDI R0, 0
    CALL BIOS_CLR

    ; dx²[x] for x = 0..79, from (2x - 80)² >> 6
    LDI R4, 0
ri_dx:
    MOV R0, R4
    SHLI R0, 1
    LDI R1, 80
    SUB R0, R1
    MUL R0, R0
    SHRI R0, 6
    LDI R1, DX2
    ADD R1, R4
    ST [R1], R0
    INC R4
    LDI R1, 80
    CMP R4, R1
    JB ri_dx

    ; dy²[y] for y = 0..59, from (2y - 60)² >> 6
    LDI R4, 0
ri_dy:
    MOV R0, R4
    SHLI R0, 1
    LDI R1, 60
    SUB R0, R1
    MUL R0, R0
    SHRI R0, 6
    LDI R1, DY2
    ADD R1, R4
    ST [R1], R0
    INC R4
    LDI R1, 60
    CMP R4, R1
    JB ri_dy

    LDI R0, 0
    STA PHASE, R0

ri_frame:
    WAIT
    CALL ri_palette

    LDI R4, 0
ri_row:
    ; warp = sin(y*3 + phase) / 16
    MOV R0, R4
    LDI R1, 3
    MUL R0, R1
    LD R1, [PHASE]
    ADD R0, R1
    CALL BIOS_SIN
    LDI R1, 4
    SAR R0, R1
    MOV R3, R0
    LDI R2, DY2
    ADD R2, R4
    LD R2, [R2]
    ADD R3, R2
    LD R2, [PHASE]
    SUB R3, R2
    ; destination row
    MOV R6, R4
    LDI R2, 320
    MUL R6, R2
    LDI R2, VRAM
    ADD R6, R2
    LDI R5, DX2
    LDI R7, 80
ri_col:
    LD R0, [R5]
    ADD R0, R3
    SHRI R0, 4
    LDI R1, 15
    AND R0, R1
    ST [R6], R0
    STO [R6+1], R0
    STO [R6+160], R0
    STO [R6+161], R0
    INC R6
    INC R6
    INC R5
    DEC R7
    JNE ri_col
    LDI R2, 160
    ADD R6, R2
    INC R4
    LDI R0, 60
    CMP R4, R0
    JB ri_row

    LD R0, [PHASE]
    ADDI R0, 3
    STA PHASE, R0
    JMP ri_frame

; ── recompute all sixteen palette entries from three sine angles ───────────
ri_palette:
    PUSH R0
    PUSH R1
    PUSH R2
    PUSH R7
    LDI R7, 0
ri_pal_loop:
    STA PAL_INDEX, R7
    ; odd indices are the bright ring of the pair, even ones the dim
    MOV R2, R7
    LDI R1, 1
    AND R2, R1
    CMPI R2, 0
    JE ri_pal_dim
    LDI R2, 13
    JMP ri_pal_have_base
ri_pal_dim:
    LDI R2, 6
ri_pal_have_base:
    MOV R0, R7
    SHLI R0, 4
    LD R1, [PHASE]
    ADD R0, R1
    LDI R1, PAL_R
    CALL ri_pal_write
    MOV R0, R7
    SHLI R0, 4
    LD R1, [PHASE]
    ADD R0, R1
    LDI R1, 85
    ADD R0, R1
    LDI R1, PAL_G
    CALL ri_pal_write
    MOV R0, R7
    SHLI R0, 4
    LD R1, [PHASE]
    ADD R0, R1
    LDI R1, 170
    ADD R0, R1
    LDI R1, PAL_B
    CALL ri_pal_write
    INC R7
    CMPI R7, 16
    JB ri_pal_loop
    POP R7
    POP R2
    POP R1
    POP R0
    RET

; angle in R0, destination in R1, brightness base in R2; writes 0..15
ri_pal_write:
    PUSH R2
    PUSH R3
    PUSH R4
    MOV R3, R1
    MOV R4, R2
    CALL BIOS_SIN
    LDI R1, 5
    SAR R0, R1
    ADD R0, R4
    CMPI R0, 0
    JGE ri_pw_lo_ok
    LDI R0, 0
ri_pw_lo_ok:
    CMPI R0, 15
    JLE ri_pw_ok
    LDI R0, 15
ri_pw_ok:
    ST [R3], R0
    POP R4
    POP R3
    POP R2
    RET
`;

const CUBE = `
; ═══════════════════════════════════════════════════════════════════════════
;  CUBE — a rotating wireframe, drawn with 8.8 fixed point arithmetic.
;
;  The CPU has no 32-bit multiply, so this cartridge brings one: a shift-add
;  multiplier (16 x 16 -> 32), a 32-bit add and subtract, and a signed
;  divide for the perspective projection. Eight vertices are rotated about
;  two axes each frame, projected, and joined by DDA lines at 8.4 precision.
; ═══════════════════════════════════════════════════════════════════════════

.def ANG_A     0x8B30
.def ANG_B     0x8B31
.def S_A       0x8B32
.def C_A       0x8B33
.def S_B       0x8B34
.def C_B       0x8B35
.def TMP0      0x8B36
.def TMP1      0x8B37
.def TMP2      0x8B38
.def TMP3      0x8B39
.def V_X1      0x8B3A
.def V_Z1      0x8B3B
.def V_Y2      0x8B3C
.def V_Z2      0x8B3D
.def SX        0x8B40
.def SY        0x8B48
.def LINE_DX   0x8B50
.def LINE_DY   0x8B51
.def LINE_XI   0x8B52
.def LINE_YI   0x8B53
.def LINE_STEPS 0x8B54
.def EDGE_I    0x8B55

.def FOCAL  96
.def DIST   768

    LDI R0, 0
    CALL BIOS_CLR
    LDI R0, 0
    STA ANG_A, R0
    LDI R0, 32
    STA ANG_B, R0
    LDI R0, 14
    STA VOLUME, R0

cube_frame:
    WAIT
    LDI R0, 0
    CALL BIOS_CLR

    ; a dim horizon and a small origin mark
    LDI R0, 0
    LDI R1, 60
    LDI R2, 160
    LDI R3, 11
    CALL BIOS_HLINE
    LDI R0, 80
    LDI R1, 0
    LDI R2, 120
    LDI R3, 11
    CALL draw_vertical
    LDI R0, 79
    LDI R1, 59
    LDI R2, 3
    LDI R3, 3
    LDI R4, 3
    CALL BIOS_RECT

    ; spin the angles and fetch their sines
    LD R0, [ANG_A]
    ADDI R0, 2
    STA ANG_A, R0
    CALL BIOS_SIN
    STA S_A, R0
    LD R0, [ANG_A]
    LDI R1, 64
    ADD R0, R1
    CALL BIOS_SIN
    STA C_A, R0
    LD R0, [ANG_B]
    ADDI R0, 1
    STA ANG_B, R0
    CALL BIOS_SIN
    STA S_B, R0
    LD R0, [ANG_B]
    LDI R1, 64
    ADD R0, R1
    CALL BIOS_SIN
    STA C_B, R0

    ; project the eight corners
    LDI R6, 0
pv_loop:
    MOV R0, R6
    LDI R1, 3
    MUL R0, R1
    LDI R1, verts
    ADD R0, R1
    LD R4, [R0]
    LDO R5, [R0+1]
    LDO R7, [R0+2]
    CALL project
    LDI R2, SX
    ADD R2, R6
    ST [R2], R0
    LDI R2, SY
    ADD R2, R6
    ST [R2], R1
    INC R6
    CMPI R6, 8
    JB pv_loop

    ; join them with twelve edges
    LDI R0, 0
    STA EDGE_I, R0
edge_loop:
    LD R6, [EDGE_I]
    MOV R0, R6
    SHLI R0, 1
    LDI R1, edges
    ADD R0, R1
    LD R2, [R0]
    LDO R3, [R0+1]
    LDI R4, SX
    ADD R4, R2
    LDI R5, SY
    ADD R5, R2
    LD R4, [R4]
    LD R5, [R5]
    LDI R6, SX
    ADD R6, R3
    LDI R7, SY
    ADD R7, R3
    LD R6, [R6]
    LD R7, [R7]
    CALL line
    LD R6, [EDGE_I]
    INC R6
    STA EDGE_I, R6
    CMPI R6, 12
    JB edge_loop

    ; corners, lit
    LDI R6, 0
vert_dot:
    LDI R0, SX
    ADD R0, R6
    LDI R1, SY
    ADD R1, R6
    LD R0, [R0]
    LD R1, [R1]
    LDI R2, 2
    LDI R3, 2
    LDI R4, 3
    CALL BIOS_RECT
    INC R6
    CMPI R6, 8
    JB vert_dot

    LDI R0, caption
    LDI R1, 16
    LDI R2, 104
    LDI R3, 10
    CALL BIOS_PRINT
    LDI R0, caption2
    LDI R1, 16
    LDI R2, 111
    LDI R3, 10
    CALL BIOS_PRINT
    JMP cube_frame

; ── draw_vertical: x = R0, y = R1, length = R2, colour = R3 ────────────────
draw_vertical:
    PUSH R0
    PUSH R1
    PUSH R2
    PUSH R3
    CMPI R2, 0
    JE dv_done
dv_loop:
    PUSH R2
    MOV R2, R3
    CALL BIOS_PIXEL
    POP R2
    INC R1
    DEC R2
    JNE dv_loop
dv_done:
    POP R3
    POP R2
    POP R1
    POP R0
    RET

; ── muls: R0 x R1 -> 32-bit product in (R0 low, R1 high), signed ───────────
muls:
    PUSH R2
    PUSH R3
    PUSH R4
    PUSH R5
    PUSH R6
    PUSH R7
    LDI R7, 0
    CMPI R0, 0
    JGE muls_a_ok
    NEG R0
    LDI R7, 1
muls_a_ok:
    CMPI R1, 0
    JGE muls_b_ok
    NEG R1
    LDI R2, 1
    XOR R7, R2
muls_b_ok:
    LDI R2, 0
    LDI R3, 0
    LDI R4, 16
muls_loop:
    MOV R5, R2
    SHRI R5, 15
    SHLI R3, 1
    OR R3, R5
    SHLI R2, 1
    MOV R5, R1
    SHRI R5, 15
    CMPI R5, 0
    JE muls_skip
    ADD R2, R0
    JAE muls_skip
    INC R3
muls_skip:
    SHLI R1, 1
    DEC R4
    JNE muls_loop
    CMPI R7, 0
    JE muls_done
    NOT R2
    NOT R3
    INC R2
    JNE muls_done
    INC R3
muls_done:
    MOV R0, R2
    MOV R1, R3
    POP R7
    POP R6
    POP R5
    POP R4
    POP R3
    POP R2
    RET

; ── add32: (R0,R1) += (R2,R3) ──────────────────────────────────────────────
add32:
    ADD R0, R2
    JAE add32_ok
    INC R3
add32_ok:
    ADD R1, R3
    RET

; ── sub32: (R0,R1) -= (R2,R3) ──────────────────────────────────────────────
sub32:
    SUB R0, R2
    JAE sub32_ok
    INC R3
sub32_ok:
    SUB R1, R3
    RET

; ── sar32_8: (R0 low, R1 high) >> 8 -> R0 ──────────────────────────────────
sar32_8:
    MOV R2, R1
    SHLI R2, 8
    MOV R3, R0
    SHRI R3, 8
    OR R2, R3
    MOV R0, R2
    RET

; ── sdiv_p: signed numerator R0 / positive denominator R1 -> R0 ────────────
sdiv_p:
    PUSH R2
    LDI R2, 0
    CMPI R0, 0
    JGE sdiv_pos
    NEG R0
    LDI R2, 1
sdiv_pos:
    DIV R0, R1
    CMPI R2, 0
    JE sdiv_done
    NEG R0
sdiv_done:
    POP R2
    RET

; ── project: (R4,R5,R7) = x,y,z in 8.8 -> R0 = sx, R1 = sy ────────────────
project:
    PUSH R2
    PUSH R3
    PUSH R4
    PUSH R5
    PUSH R6
    PUSH R7
    ; x1 = (x*cosA - z*sinA) >> 8
    MOV R0, R4
    LD R1, [C_A]
    CALL muls
    STA TMP0, R0
    STA TMP1, R1
    MOV R0, R7
    LD R1, [S_A]
    CALL muls
    STA TMP2, R0
    STA TMP3, R1
    LD R0, [TMP0]
    LD R1, [TMP1]
    LD R2, [TMP2]
    LD R3, [TMP3]
    CALL sub32
    CALL sar32_8
    STA V_X1, R0
    ; z1 = (x*sinA + z*cosA) >> 8
    MOV R0, R4
    LD R1, [S_A]
    CALL muls
    STA TMP0, R0
    STA TMP1, R1
    MOV R0, R7
    LD R1, [C_A]
    CALL muls
    STA TMP2, R0
    STA TMP3, R1
    LD R0, [TMP0]
    LD R1, [TMP1]
    LD R2, [TMP2]
    LD R3, [TMP3]
    CALL add32
    CALL sar32_8
    STA V_Z1, R0
    ; y2 = (y*cosB - z1*sinB) >> 8
    MOV R0, R5
    LD R1, [C_B]
    CALL muls
    STA TMP0, R0
    STA TMP1, R1
    LD R0, [V_Z1]
    LD R1, [S_B]
    CALL muls
    STA TMP2, R0
    STA TMP3, R1
    LD R0, [TMP0]
    LD R1, [TMP1]
    LD R2, [TMP2]
    LD R3, [TMP3]
    CALL sub32
    CALL sar32_8
    STA V_Y2, R0
    ; z2 = (y*sinB + z1*cosB) >> 8
    MOV R0, R5
    LD R1, [S_B]
    CALL muls
    STA TMP0, R0
    STA TMP1, R1
    LD R0, [V_Z1]
    LD R1, [C_B]
    CALL muls
    STA TMP2, R0
    STA TMP3, R1
    LD R0, [TMP0]
    LD R1, [TMP1]
    LD R2, [TMP2]
    LD R3, [TMP3]
    CALL add32
    CALL sar32_8
    STA V_Z2, R0
    ; sx = 80 + (x1 * FOCAL) / (z2 + DIST)
    LD R0, [V_X1]
    LDI R1, FOCAL
    MUL R0, R1
    LD R1, [V_Z2]
    LDI R2, DIST
    ADD R1, R2
    CALL sdiv_p
    LDI R2, 80
    ADD R0, R2
    STA V_X1, R0
    ; sy = 60 + (y2 * FOCAL) / (z2 + DIST)
    LD R0, [V_Y2]
    LDI R1, FOCAL
    MUL R0, R1
    LD R1, [V_Z2]
    LDI R2, DIST
    ADD R1, R2
    CALL sdiv_p
    LDI R2, 60
    ADD R0, R2
    MOV R1, R0
    LD R0, [V_X1]
    POP R7
    POP R6
    POP R5
    POP R4
    POP R3
    POP R2
    RET

; ── line: DDA from (R4,R5) to (R6,R7) at 8.4 fixed point ───────────────────
line:
    PUSH R0
    PUSH R1
    PUSH R2
    PUSH R3
    PUSH R4
    PUSH R5
    PUSH R6
    PUSH R7
    MOV R0, R6
    SUB R0, R4
    STA LINE_DX, R0
    MOV R1, R7
    SUB R1, R5
    STA LINE_DY, R1
    MOV R2, R0
    CMPI R2, 0
    JGE line_absx
    NEG R2
line_absx:
    MOV R3, R1
    CMPI R3, 0
    JGE line_absy
    NEG R3
line_absy:
    CMP R2, R3
    JAE line_steps_ok
    MOV R2, R3
line_steps_ok:
    CMPI R2, 0
    JE line_dot
    STA LINE_STEPS, R2
    LD R0, [LINE_DX]
    LDI R1, 16
    MUL R0, R1
    LD R1, [LINE_STEPS]
    CALL sdiv_p
    STA LINE_XI, R0
    LD R0, [LINE_DY]
    LDI R1, 16
    MUL R0, R1
    LD R1, [LINE_STEPS]
    CALL sdiv_p
    STA LINE_YI, R0
    SHLI R4, 4
    SHLI R5, 4
    LD R6, [LINE_STEPS]
    INC R6
line_loop:
    MOV R0, R4
    LDI R1, 4
    SAR R0, R1
    MOV R1, R5
    LDI R2, 4
    SAR R1, R2
    LDI R2, 1
    CALL BIOS_PIXEL
    LD R0, [LINE_XI]
    ADD R4, R0
    LD R0, [LINE_YI]
    ADD R5, R0
    DEC R6
    JNE line_loop
    JMP line_done
line_dot:
    MOV R0, R4
    MOV R1, R5
    LDI R2, 1
    CALL BIOS_PIXEL
line_done:
    POP R7
    POP R6
    POP R5
    POP R4
    POP R3
    POP R2
    POP R1
    POP R0
    RET

caption:
    .asciiz "8 VERTICES / 12 EDGES"
caption2:
    .asciiz "32-BIT MATH, NO GPU"

verts:
    .word -200, -200, -200
    .word  200, -200, -200
    .word -200,  200, -200
    .word  200,  200, -200
    .word -200, -200,  200
    .word  200, -200,  200
    .word -200,  200,  200
    .word  200,  200,  200

edges:
    .word 0, 1,  0, 2,  0, 4
    .word 1, 3,  1, 5
    .word 2, 3,  2, 6
    .word 3, 7
    .word 4, 5,  4, 6
    .word 5, 7
    .word 6, 7
`;

export const CARTS = [
  {
    id: 'boot',
    name: 'BOOT',
    file: 'BOOT.ROM',
    tagline: 'the machine waking up',
    blurb:
      'The ROM the machine runs before it knows anything else. Paints its palette, drifts a phosphor sine across the tube, plays a small chime and waits for software.',
    chips: ['BIOS calls', 'sine table', 'sound chip'],
    source: BOOT,
  },
  {
    id: 'snake',
    name: 'SNAKE',
    file: 'SNAKE.ASM',
    tagline: 'twenty cells wide and hungry',
    blurb:
      'A complete game: move, steer, collide, eat, grow, die, restart. The body is a ring buffer in RAM, dinner is placed by the hardware random generator, and the speed ramps up until you lose.',
    chips: ['ring buffer', 'hardware RNG', 'game loop', 'sound effects'],
    source: SNAKE,
  },
  {
    id: 'fire',
    name: 'FIRE',
    file: 'FIRE.ASM',
    tagline: 'heat rising, one third per row',
    blurb:
      'A cellular heat field at half resolution, blown up into the frame buffer through a 16-step ember palette. The whole simulation is a few loops over RAM; the randomness comes from the chip, the glow from the palette.',
    chips: ['cellular automaton', 'palette art', 'integer averaging'],
    source: FIRE,
  },
  {
    id: 'life',
    name: 'LIFE',
    file: 'LIFE.ASM',
    tagline: 'fifty-three by forty, endlessly wrapped',
    blurb:
      "Conway's rules, double buffered, wrapped at every edge. A padded border ring removes all edge tests from the inner loop, so the whole universe advances in one pass. A button reseeds the soup.",
    chips: ['double buffer', "Conway's rules", 'toroidal grid'],
    source: LIFE,
  },
  {
    id: 'chiptune',
    name: 'CHIPTUNE',
    file: 'CHIPTUNE.ASM',
    tagline: 'sixty-four rows, three channels, one loop',
    blurb:
      'A tracker written in assembly. The score sits at the bottom of the ROM as note periods; every sixth frame the player loads new pitches into the pulse and noise channels. Level meters, a pattern bar and sixteen decorative bars dance along.',
    chips: ['tracker', 'sound chip', 'VU meters', 'sine table'],
    source: CHIPTUNE,
  },
  {
    id: 'cube',
    name: 'CUBE',
    file: 'CUBE.ASM',
    tagline: 'eight corners, twelve edges, no GPU',
    blurb:
      'A wireframe cube spun on two axes. The CPU is 16-bit and has no hardware multiply worth the name, so the cartridge builds a shift-add 32-bit multiplier, a signed divider and a DDA line renderer, then does the rotations in 8.8 fixed point.',
    chips: ['32-bit multiply', 'fixed point', 'perspective', 'DDA lines'],
    source: CUBE,
  },
  {
    id: 'ripple',
    name: 'RIPPLE',
    file: 'RIPPLE.ASM',
    tagline: 'concentric arithmetic, colour crawling',
    blurb:
      'A distance field becomes travelling rings; a per-row sine warp makes them wobble like water; and every frame all sixteen palette entries are recomputed from three phase-shifted sine angles, so the colours crawl around the wheel.',
    chips: ['distance field', 'palette animation', 'sine table'],
    source: RIPPLE,
  },
];

export const CARTS_BY_ID = Object.fromEntries(CARTS.map((c) => [c.id, c]));
