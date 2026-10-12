"""Copies the button icons the game shows out of Kenney's Input Prompts pack
(CC0, https://kenney.nl/assets/input-prompts) into assets/prompts/.

    python3 tools/input_prompts.py kenney_input-prompts_1.5.zip

src/controls.js says which icon stands for which button; this is the list
of files it uses, by the pack's own names.
"""
import sys
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'assets' / 'prompts'
ICONS = {
    'Xbox Series': [
        'xbox_button_color_a', 'xbox_button_color_b', 'xbox_button_color_x', 'xbox_button_color_y',
        'xbox_lb', 'xbox_rb', 'xbox_lt', 'xbox_rt', 'xbox_button_menu', 'xbox_button_view',
        'xbox_stick_l', 'xbox_dpad',
    ],
    'PlayStation Series': [
        'playstation_button_color_cross', 'playstation_button_color_circle',
        'playstation_button_color_square', 'playstation_button_color_triangle',
        'playstation_trigger_l1', 'playstation_trigger_r1', 'playstation_trigger_l2', 'playstation_trigger_r2',
        'playstation4_button_options', 'playstation5_button_create', 'playstation_stick_l', 'playstation_dpad',
    ],
    'Nintendo Switch': [
        'switch_button_a', 'switch_button_b', 'switch_button_x', 'switch_button_y',
        'switch_button_l', 'switch_button_r', 'switch_button_zl', 'switch_button_zr',
        'switch_button_plus', 'switch_button_minus', 'switch_stick_l', 'switch_dpad',
    ],
    'Keyboard & Mouse': [
        'keyboard_w', 'keyboard_a', 'keyboard_s', 'keyboard_d',
        'keyboard_arrow_up', 'keyboard_arrow_down', 'keyboard_arrow_left', 'keyboard_arrow_right',
        'keyboard_shift', 'keyboard_space', 'keyboard_escape', 'keyboard_p', 'keyboard_f',
        'keyboard_backspace_icon',
    ],
}


def main(pack):
    OUT.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(pack) as z:
        for folder, names in ICONS.items():
            for name in names:
                (OUT / f'{name}.svg').write_bytes(z.read(f'{folder}/Vector/{name}.svg'))
    print(f'{sum(map(len, ICONS.values()))} icons -> {OUT}')


if __name__ == '__main__':
    main(sys.argv[1])
